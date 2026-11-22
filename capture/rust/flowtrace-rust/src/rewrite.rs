//! Splices FlowTrace spans into the function bodies of one Rust source file.
//!
//! Like the Go transformer this is byte-splicing at AST offsets, not printing a
//! mutated AST: every insertion is on a single line and removes nothing, so
//! line numbers, comments and formatting survive, and a panic reports the
//! original file at the original line.
//!
//! Columns survive only where nothing follows the insertion on its line. A
//! function whose body shares a line with its `{` (or with code after its `}`)
//! would report panics at a column shifted by the prologue's length, so it is
//! left uninstrumented and counted in `Rewritten::skipped_inline`; `rustfmt`
//! puts every body on its own lines, which makes the case rare in real code.
//!
//! Each instrumented body `{ ... }` becomes
//!
//! ```text
//! { static META; let guard = enter(..args..); let r = call(move || -> Ret { ... }); guard.finish(&r); r }
//! ```
//!
//! The body keeps its own braces, so `return` and `?` still leave the function
//! (they now leave the closure, which has the function's return type), and the
//! `Result` that comes out is the one the guard reports. A body that cannot be
//! wrapped in a closure with a nameable type (`-> impl Trait`, `-> !`) only gets
//! the guard, which still records enter, exit, duration and panics.

use quote::ToTokens;
use syn::{Attribute, FnArg, ImplItem, Item, Pat, ReturnType, Signature, TraitItem, Type, Visibility};

/// Traits whose methods are never instrumented. Their bodies are called from
/// inside the runtime's own formatting (`Debug`, `Display`), would recurse
/// through it, or are so hot and so mechanical that a span per call is noise
/// (`Iterator::next`, operators, `Deref`).
const SKIPPED_TRAITS: &[&str] = &[
    "Drop", "Debug", "Display", "Clone", "Default", "PartialEq", "Eq", "PartialOrd", "Ord", "Hash",
    "Hasher", "Deref", "DerefMut", "Index", "IndexMut", "From", "Into", "TryFrom", "AsRef", "AsMut",
    "Borrow", "BorrowMut", "Iterator", "DoubleEndedIterator", "ExactSizeIterator", "IntoIterator",
    "Future", "Neg", "Not", "Add", "Sub", "Mul", "Div", "Rem", "BitAnd", "BitOr", "BitXor", "Shl",
    "Shr", "AddAssign", "SubAssign", "MulAssign", "DivAssign", "GlobalAlloc", "Error",
];

pub struct Options<'a> {
    /// The package name with `-` turned into `_`; the first segment of `module`.
    pub package: &'a str,
    /// Module path of this file below `src/`, e.g. `["wal", "log"]`.
    pub file_module: Vec<String>,
    /// Only items whose module path starts with this are instrumented.
    pub prefix: &'a str,
}

pub struct Rewritten {
    pub text: String,
    pub functions: usize,
    /// Functions left alone because instrumenting them would shift a column.
    pub skipped_inline: usize,
}

pub fn instrument(src: &str, opts: &Options<'_>) -> Result<Rewritten, syn::Error> {
    // syn drops a leading `#!shebang` before lexing, which would shift every offset.
    if src.starts_with("#!") && !src.starts_with("#![") {
        return Ok(Rewritten { text: src.to_owned(), functions: 0, skipped_inline: 0 });
    }
    let file = syn::parse_file(src)?;
    let mut rw = Rewriter { src, opts, mods: opts.file_module.clone(), edits: Vec::new(), functions: 0, skipped_inline: 0 };
    rw.items(&file.items);

    let mut text = src.to_owned();
    // Highest offset first, so earlier offsets stay valid. Edits never overlap.
    rw.edits.sort_by_key(|e| std::cmp::Reverse(e.0));
    for (at, s) in rw.edits {
        text.insert_str(at, &s);
    }
    Ok(Rewritten { text, functions: rw.functions, skipped_inline: rw.skipped_inline })
}

struct Rewriter<'a> {
    src: &'a str,
    opts: &'a Options<'a>,
    mods: Vec<String>,
    edits: Vec<(usize, String)>,
    functions: usize,
    skipped_inline: usize,
}

/// True if code shares a line with the body's `{` or follows its `}`: the
/// spliced text would move that code to another column.
fn shifts_columns(src: &str, open: usize, close: usize) -> bool {
    let code = |rest: &str, allowed: &str| {
        let line = rest.lines().next().unwrap_or("").trim();
        !line.is_empty() && !line.starts_with("//") && !line.chars().all(|c| allowed.contains(c))
    };
    code(&src[open + 1..close - 1], "") || code(&src[close..], "})];,")
}

fn attr_words(a: &Attribute) -> Vec<String> {
    a.meta
        .require_list()
        .map(|l| {
            l.tokens
                .to_string()
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .filter(|w| !w.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// `#[cfg(test)]`, `#[cfg(any(test, ...))]`. A `not(...)` anywhere means the item
/// can still be production code, so it is kept: skipping it wrongly would
/// produce the one failure this tool must not have, a silently thin trace.
fn is_test_only(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|a| {
        a.path().is_ident("cfg") && {
            let w = attr_words(a);
            w.iter().any(|x| x == "test") && !w.iter().any(|x| x == "not")
        }
    })
}

fn skip_function(attrs: &[Attribute], sig: &Signature) -> bool {
    if sig.constness.is_some() || sig.asyncness.is_some() || sig.variadic.is_some() {
        return true;
    }
    if is_test_only(attrs) {
        return true;
    }
    attrs.iter().any(|a| {
        let p = a.path();
        // `track_caller`: a closure would change what `Location::caller()` reports.
        // `inline(always)`: the author asked for no call overhead.
        p.is_ident("test")
            || p.is_ident("bench")
            || p.is_ident("track_caller")
            || p.is_ident("naked")
            || p.is_ident("proc_macro")
            || p.is_ident("proc_macro_attribute")
            || p.is_ident("proc_macro_derive")
            || (p.is_ident("inline") && attr_words(a).iter().any(|w| w == "always"))
    })
}

fn visibility(vis: &Visibility, in_trait: bool) -> &'static str {
    match vis {
        Visibility::Public(_) => "public",
        Visibility::Restricted(_) => "internal",
        // A trait method has no `pub` of its own: it is as visible as the trait.
        Visibility::Inherited if in_trait => "public",
        Visibility::Inherited => "private",
    }
}

fn class_name(ty: &Type) -> String {
    match ty {
        Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default(),
        Type::Reference(r) => class_name(&r.elem),
        Type::Paren(p) => class_name(&p.elem),
        Type::Group(g) => class_name(&g.elem),
        Type::Slice(_) => "[slice]".to_owned(),
        Type::Array(_) => "[array]".to_owned(),
        Type::Tuple(_) => "(tuple)".to_owned(),
        other => other.to_token_stream().to_string(),
    }
}

/// True if the type is, or contains, `impl Trait` or `!`: nothing a closure's
/// return annotation can spell.
fn unnameable(ty: &Type) -> bool {
    struct V(bool);
    impl<'ast> syn::visit::Visit<'ast> for V {
        fn visit_type_impl_trait(&mut self, _: &'ast syn::TypeImplTrait) {
            self.0 = true;
        }
        fn visit_type_never(&mut self, _: &'ast syn::TypeNever) {
            self.0 = true;
        }
    }
    let mut v = V(false);
    syn::visit::Visit::visit_type(&mut v, ty);
    v.0
}

fn rust_str(s: &str) -> String {
    format!("{s:?}")
}

impl Rewriter<'_> {
    fn module(&self) -> String {
        let mut m = self.opts.package.to_owned();
        for part in &self.mods {
            m.push_str("::");
            m.push_str(part);
        }
        m
    }

    fn items(&mut self, items: &[Item]) {
        for item in items {
            match item {
                Item::Fn(f) => self.function(&f.attrs, &f.vis, &f.sig, &f.block, "", false),
                Item::Mod(m) if !is_test_only(&m.attrs) => {
                    if let Some((_, content)) = &m.content {
                        self.mods.push(m.ident.to_string());
                        self.items(content);
                        self.mods.pop();
                    }
                }
                Item::Impl(i) if !is_test_only(&i.attrs) => {
                    let skipped = i.trait_.as_ref().is_some_and(|(_, path, _)| {
                        path.segments.last().is_some_and(|s| SKIPPED_TRAITS.contains(&s.ident.to_string().as_str()))
                    });
                    if skipped {
                        continue;
                    }
                    let class = class_name(&i.self_ty);
                    for ii in &i.items {
                        if let ImplItem::Fn(f) = ii {
                            self.function(&f.attrs, &f.vis, &f.sig, &f.block, &class, i.trait_.is_some());
                        }
                    }
                }
                Item::Trait(t) if !is_test_only(&t.attrs) => {
                    let class = t.ident.to_string();
                    for ti in &t.items {
                        if let TraitItem::Fn(f) = ti {
                            if let Some(block) = &f.default {
                                self.function(&f.attrs, &Visibility::Inherited, &f.sig, block, &class, true);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn function(&mut self, attrs: &[Attribute], vis: &Visibility, sig: &Signature, block: &syn::Block, class: &str, in_trait: bool) {
        if skip_function(attrs, sig) {
            return;
        }
        let module = self.module();
        if !module.starts_with(self.opts.prefix) {
            return;
        }
        let open = block.brace_token.span.open().byte_range().start;
        let close = block.brace_token.span.close().byte_range().end;
        // Offsets of 0 mean the span carried no location (a macro-expanded body).
        if close <= open || close == 0 {
            return;
        }

        if shifts_columns(self.src, open, close) {
            self.skipped_inline += 1;
            return;
        }

        let name = sig.ident.to_string();
        let name = name.trim_start_matches("r#");
        let ret = match &sig.output {
            ReturnType::Default => Some("()".to_owned()),
            ReturnType::Type(_, ty) if unnameable(ty) => None,
            ReturnType::Type(_, ty) => Some(ty.to_token_stream().to_string()),
        };

        let mut pre = format!(
            "{{ static __FT_M: ::flowtrace::__rt::Meta = ::flowtrace::__rt::Meta::new({}, {}, {}, {}); ",
            rust_str(&module),
            rust_str(class),
            rust_str(name),
            rust_str(visibility(vis, in_trait)),
        );
        pre.push_str("let __ft_g = ::flowtrace::__rt::enter(&__FT_M, &mut |__ft_a| { ");
        let mut named = Vec::new();
        for arg in &sig.inputs {
            if let FnArg::Typed(pt) = arg {
                if let Pat::Ident(pi) = &*pt.pat {
                    if pi.subpat.is_none() {
                        named.push(pi.ident.to_string());
                    }
                }
            }
        }
        if named.is_empty() {
            pre.push_str("let _ = __ft_a; ");
        } else {
            pre.push_str("#[allow(unused_imports)] use ::flowtrace::__rt::probe::*; ");
            for n in &named {
                let label = n.trim_start_matches("r#");
                pre.push_str(&format!("__ft_a.arg({}, &mut |__ft_o| (&&__FtP(&{n})).ft_arg(__ft_o)); ", rust_str(label)));
            }
        }
        pre.push_str("}); ");

        let post = match ret {
            Some(ret) => {
                // `call` takes an `FnOnce`, which makes the closure one: a `&mut self`
                // method returning `&mut T` hands back a reborrow of a captured `&mut`,
                // and rustc rejects that in an `FnMut` closure (what it would infer).
                pre.push_str(&format!("let __ft_r = ::flowtrace::__rt::call(move || -> {ret} "));
                "); __ft_g.finish(&mut |__ft_o| { #[allow(unused_imports)] use ::flowtrace::__rt::probe::*; (&&&&&&&&&&&__FtP(&__ft_r)).ft_result(__ft_o); }); __ft_r }".to_owned()
            }
            None => " }".to_owned(),
        };

        self.edits.push((open, pre));
        self.edits.push((close, post));
        self.functions += 1;
    }
}

#[cfg(test)]
mod tests;
