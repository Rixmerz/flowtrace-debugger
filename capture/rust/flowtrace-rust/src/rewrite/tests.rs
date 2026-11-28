use super::{instrument, Options};

fn run(src: &str, prefix: &str) -> (String, usize) {
    let r = instrument(src, &Options { package: "demo", file_module: vec!["wal".into()], prefix, file: None }).expect("parses");
    (r.text, r.functions)
}

#[test]
fn keeps_every_line_where_it_was() {
    let src = "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\nfn helper() {\n}\n";
    let (out, n) = run(src, "");
    assert_eq!(n, 2);
    assert_eq!(out.lines().count(), src.lines().count(), "a panic must still report the original line");
    // Everything that was there is still there, in order.
    for line in ["    a + b", "fn helper()"] {
        assert!(out.contains(line));
    }
}

#[test]
fn records_module_class_visibility_and_arguments() {
    let src = "pub struct S;\nimpl S {\n    pub(crate) fn go(&self, n: u8, mut s: String) -> u8 {\n        n\n    }\n}\n";
    let (out, _) = run(src, "");
    assert!(out.contains(r#"Meta::new("demo::wal", "S", "go", "internal")"#), "{out}");
    assert!(out.contains(r#"__ft_a.arg("n""#) && out.contains(r#"__ft_a.arg("s""#));
    assert!(!out.contains(r#"arg("self""#), "the receiver is not an argument");
    assert!(out.contains("-> u8 "), "a nameable return type gets the closure form");
}

#[test]
fn what_cannot_be_wrapped_is_skipped_or_guard_only() {
    let src = r#"
const fn c() {}
async fn a() {}
#[inline(always)] fn hot() {}
#[track_caller] fn tc() {}
#[test] fn t() {}
#[cfg(test)] mod tests { fn helper() {} }
fn it() -> impl Iterator<Item = u8> {
    std::iter::empty()
}
fn never() -> ! {
    loop {}
}
fn plain() {}
fn declared_only();
"#;
    // `declared_only();` is not valid in a module; use a trait for bodiless fns.
    let src = src.replace("fn declared_only();\n", "");
    let (out, n) = run(&src, "");
    assert_eq!(n, 3, "only it, never and plain: {out}");
    assert_eq!(out.matches("__rt::call(").count(), 1, "impl-Trait and `!` returns take the guard only: {out}");
}

#[test]
fn trait_impls_that_would_recurse_are_left_alone() {
    let src = r#"
struct P;
impl std::fmt::Debug for P { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { Ok(()) } }
impl Drop for P { fn drop(&mut self) {} }
impl Iterator for P { type Item = u8; fn next(&mut self) -> Option<u8> { None } }
trait Shape {
    fn area(&self) -> u32 {
        1
    }
    fn name(&self) -> &str;
}
impl Shape for P {
    fn area(&self) -> u32 {
        2
    }
    fn name(&self) -> &str {
        "p"
    }
}
"#;
    let (out, n) = run(src, "");
    assert_eq!(n, 3, "Shape::area (default), Shape for P::{{area,name}}: {out}");
    assert!(out.contains(r#"Meta::new("demo::wal", "Shape", "area", "public")"#));
}

#[test]
fn the_prefix_filters_by_module_path() {
    let src = "fn f() {}\nmod inner { pub fn g() {} }\n";
    assert_eq!(run(src, "").1, 2);
    assert_eq!(run(src, "demo::wal").1, 2);
    assert_eq!(run(src, "demo::wal::inner").1, 1);
    assert_eq!(run(src, "other").1, 0);
}

#[test]
fn test_modules_are_skipped_but_not_cfg_not_test() {
    let src = "#[cfg(test)] mod t { fn a() {} }\n#[cfg(not(test))] fn prod() {}\n#[cfg(any(test, feature = \"x\"))] fn maybe() {}\n";
    let (_, n) = run(src, "");
    assert_eq!(n, 1, "only the cfg(not(test)) function is production code");
}

#[test]
fn a_shebang_file_is_left_alone() {
    let (out, n) = run("#!/usr/bin/env run-cargo-script\nfn main() {}\n", "");
    assert_eq!(n, 0);
    assert!(out.starts_with("#!/usr/bin/env"));
}

#[test]
fn unparseable_source_is_an_error_not_a_panic() {
    assert!(instrument("fn (", &Options { package: "d", file_module: vec![], prefix: "", file: None }).is_err());
}

#[test]
fn code_stays_in_its_column_and_inline_bodies_are_skipped() {
    let src = "fn ok() {\n    panic!(\"x\")\n}\nfn never() -> ! { panic!(\"boom\") }\nfn a() {} fn b() {\n    1;\n}\n";
    let r = instrument(src, &Options { package: "d", file_module: vec![], prefix: "", file: None }).expect("parses");
    assert_eq!((r.functions, r.skipped_inline), (2, 2), "`ok` and `b` are traced: {}", r.text);
    // Every original line is still a prefix of its output line, so no column moved.
    for (o, n) in src.lines().zip(r.text.lines()) {
        assert!(n.starts_with(o) || o == "}" , "{n:?} does not start with {o:?}");
    }
    assert!(r.text.lines().nth(1).unwrap().starts_with("    panic!(\"x\")"));
}

fn located(src: &str) -> String {
    let opts = Options { package: "demo", file_module: vec!["wal".into()], prefix: "", file: Some("crates/demo/src/wal.rs") };
    instrument(src, &opts).expect("parses").text
}

#[test]
fn the_declaration_line_and_original_file_are_spliced_in_as_literals() {
    let src = "\
pub struct S;

impl S {
    /// A doc comment,
    /// on two lines.
    #[inline]
    #[must_use]
    pub fn method(&self, n: u8) -> u8 {
        n
    }
}

fn free() {
}

#[cfg(not(test))]
pub(crate) fn spread<T>(
    t: T,
) -> T
where
    T: Clone,
{
    t
}

mod inner {
    pub fn nested() {
    }
}
";
    let out = located(src);
    // An impl method behind doc comments and attributes: the `fn` keyword's line.
    assert!(out.contains(r#"Meta::located("demo::wal", "S", "method", "public", "crates/demo/src/wal.rs", 8)"#), "{out}");
    // A free function.
    assert!(out.contains(r#"Meta::located("demo::wal", "", "free", "private", "crates/demo/src/wal.rs", 13)"#), "{out}");
    // A signature spread over several lines, behind an attribute.
    assert!(out.contains(r#"Meta::located("demo::wal", "", "spread", "internal", "crates/demo/src/wal.rs", 17)"#), "{out}");
    // An inline module keeps the file it is written in.
    assert!(out.contains(r#"Meta::located("demo::wal::inner", "", "nested", "public", "crates/demo/src/wal.rs", 27)"#), "{out}");
    assert!(!out.contains("Meta::new("), "every function got its location: {out}");
    assert_eq!(out.lines().count(), src.lines().count(), "the lines reported are still the lines of the output");
}

#[test]
fn trait_default_methods_and_trait_impls_report_their_own_lines() {
    let src = "trait Shape {\n    fn area(&self) -> u32 {\n        1\n    }\n}\nstruct P;\nimpl Shape for P {\n    #[allow(dead_code)]\n    fn area(&self) -> u32 {\n        2\n    }\n}\n";
    let out = located(src);
    assert!(out.contains(r#"Meta::located("demo::wal", "Shape", "area", "public", "crates/demo/src/wal.rs", 2)"#), "{out}");
    assert!(out.contains(r#"Meta::located("demo::wal", "P", "area", "public", "crates/demo/src/wal.rs", 9)"#), "{out}");
}

#[test]
fn without_a_file_no_location_is_recorded() {
    let (out, n) = run("fn f() {\n}\n", "");
    assert_eq!(n, 1);
    assert!(out.contains("Meta::new(") && !out.contains("located("), "{out}");
}
