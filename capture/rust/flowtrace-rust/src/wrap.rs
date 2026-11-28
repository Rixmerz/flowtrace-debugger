//! The `RUSTC_WORKSPACE_WRAPPER` half: cargo runs this binary in place of
//! `rustc` for every crate of the workspace being built (and for no other crate:
//! dependencies from crates.io or outside the workspace compile untouched).
//!
//! For each crate it
//!  1. mirrors the package's `src/` into a shadow tree under the instrumented
//!     target directory, with every `.rs` file rewritten by [`crate::rewrite`]
//!     and everything else in the package symlinked, so `include_str!`,
//!     `#[path]` and `mod` resolve exactly as in the original;
//!  2. runs the real rustc on the shadow root, with the runtime added through
//!     `--extern` and original paths restored with `--remap-path-prefix`;
//!  3. rewrites the dep-info file back to the original paths, so cargo still
//!     notices when *your* sources change.
//!
//! The user's tree is never written to. If rustc rejects the instrumented
//! source, the crate is built untouched instead and a note says so: instrumentation
//! is best-effort, the build is not.

use crate::rewrite::{self, Options};
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

pub const ENV_MODE: &str = "FLOWTRACE_RUSTC_WRAPPER";
pub const ENV_RLIB: &str = "FLOWTRACE_RT_RLIB";
pub const ENV_RT_DIR: &str = "FLOWTRACE_RT_DIR";
pub const ENV_SHADOW: &str = "FLOWTRACE_SHADOW_DIR";
pub const ENV_PREFIX: &str = "FLOWTRACE_PACKAGE_PREFIX";
/// `package=module_root;...`: how each workspace package is named in a Rust path.
pub const ENV_ROOTS: &str = "FLOWTRACE_MODULE_ROOTS";
/// The project root the trace's `file` paths are relative to, resolved by the
/// driver: `FLOWTRACE_ROOT` if the user set it, else the cargo workspace root.
pub const ENV_SOURCE_ROOT: &str = "FLOWTRACE_SOURCE_ROOT";

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Everything that decides whether and how this compile is instrumented.
struct Unit {
    root: PathBuf,
    root_index: usize,
    crate_name: String,
    edition: String,
}

fn parse_unit(args: &[String]) -> Option<Unit> {
    let root_index = args.iter().enumerate().position(|(i, a)| {
        a.ends_with(".rs") && !a.starts_with('-') && (i == 0 || args[i - 1] != "-o")
    })?;
    let value_of = |flag: &str| -> Option<String> {
        let eq = format!("{flag}=");
        args.iter().enumerate().find_map(|(i, a)| {
            if a == flag {
                args.get(i + 1).cloned()
            } else {
                a.strip_prefix(&eq).map(str::to_owned)
            }
        })
    };
    Some(Unit {
        root: PathBuf::from(&args[root_index]),
        root_index,
        crate_name: value_of("--crate-name")?,
        edition: value_of("--edition").unwrap_or_else(|| "2015".to_owned()),
    })
}

fn is_proc_macro(args: &[String]) -> bool {
    args.iter().enumerate().any(|(i, a)| {
        a == "--crate-type=proc-macro" || (a == "--crate-type" && args.get(i + 1).is_some_and(|v| v == "proc-macro"))
    })
}

/// Entry point in wrapper mode: `args` are `rustc` followed by its arguments.
pub fn run(args: Vec<String>) -> ExitCode {
    let (rustc, rest) = match args.split_first() {
        Some((r, rest)) => (r.clone(), rest.to_vec()),
        None => return ExitCode::from(2),
    };
    let rt_dir = env(ENV_RT_DIR);
    let Some(unit) = parse_unit(&rest) else {
        return passthrough(&rustc, &rest);
    };
    // Build scripts and proc macros run at build time; instrumenting them would
    // write events into the trace of a program that is not running yet.
    if unit.crate_name.starts_with("build_script_") || is_proc_macro(&rest) {
        return passthrough(&rustc, &rest);
    }

    // Workspace crates that are not instrumented (tests, examples, benches, bins
    // outside the prefix) still link against instrumented ones, and rustc must
    // find the runtime rlib those were compiled against.
    let mut base = rest.clone();
    if let Some(dir) = &rt_dir {
        base.push("-L".into());
        base.push(format!("dependency={dir}"));
    }

    match plan(&unit) {
        Plan::Skip(why) => {
            if let Some(why) = why {
                eprintln!("[flowtrace] note: {} is built without instrumentation ({why})", unit.crate_name);
            }
            passthrough(&rustc, &base)
        }
        Plan::Instrument(p) => instrumented(&rustc, &rest, &base, &unit, &p),
    }
}

fn passthrough(rustc: &str, args: &[String]) -> ExitCode {
    match Command::new(rustc).args(args).status() {
        Ok(s) => exit_code(s.code()),
        Err(e) => {
            eprintln!("[flowtrace] cannot run {rustc}: {e}");
            ExitCode::from(1)
        }
    }
}

fn exit_code(code: Option<i32>) -> ExitCode {
    ExitCode::from(code.map_or(1, |c| u8::try_from(c).unwrap_or(1)))
}

struct Planned {
    manifest_dir: PathBuf,
    shadow_manifest: PathBuf,
    package: String,
    prefix: String,
    rlib: String,
    /// See [`ENV_SOURCE_ROOT`]. `None` (a wrapper run without the driver) records no `file`.
    source_root: Option<PathBuf>,
}

enum Plan {
    Skip(Option<String>),
    Instrument(Planned),
}

fn stable_hash(s: &str) -> String {
    // DefaultHasher::new() is fixed-key, so this is stable within one toolchain —
    // which is all a cache directory name needs.
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn plan(unit: &Unit) -> Plan {
    let (Some(rlib), Some(shadow), Some(manifest)) = (env(ENV_RLIB), env(ENV_SHADOW), env("CARGO_MANIFEST_DIR")) else {
        return Plan::Skip(None);
    };
    let manifest_dir = PathBuf::from(manifest);
    let src = manifest_dir.join("src");
    let root = if unit.root.is_absolute() { unit.root.clone() } else { std::env::current_dir().unwrap_or_default().join(&unit.root) };
    // Integration tests, examples and benches are the program's callers, not its
    // behaviour: only `src/` is traced.
    if !root.starts_with(&src) {
        return Plan::Skip(None);
    }
    // `::flowtrace` resolves through the extern prelude, which edition 2015 lacks.
    if unit.edition == "2015" {
        return Plan::Skip(Some("edition 2015 predates the extern prelude".into()));
    }
    let package = env("CARGO_PKG_NAME").unwrap_or_else(|| unit.crate_name.clone()).replace('-', "_");
    // `module` and the prefix speak the language of Rust paths, which is the library
    // target's name, not the package's (`kerno_storage` for `kernodb-storage`).
    let module_root = env(ENV_ROOTS)
        .and_then(|roots| roots.split(';').find_map(|kv| kv.strip_prefix(&format!("{package}=")).map(str::to_owned)))
        .unwrap_or_else(|| package.clone());
    let prefix = env(ENV_PREFIX).unwrap_or_default();
    // Whole-crate cut: `kerno_storage::wal` keeps `kerno_storage`, drops `kerno_units`.
    if !(module_root.starts_with(&prefix) || prefix.starts_with(&format!("{module_root}::"))) {
        return Plan::Skip(None);
    }
    let shadow_manifest = PathBuf::from(shadow).join(format!("{package}-{}", stable_hash(&manifest_dir.to_string_lossy())));
    let source_root = env(ENV_SOURCE_ROOT).filter(|r| !r.is_empty()).map(PathBuf::from);
    Plan::Instrument(Planned { manifest_dir, shadow_manifest, package: module_root, prefix, rlib, source_root })
}

fn instrumented(rustc: &str, rest: &[String], base: &[String], unit: &Unit, p: &Planned) -> ExitCode {
    let functions = match sync_shadow(p) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("[flowtrace] note: {} is built without instrumentation ({e})", unit.crate_name);
            return passthrough(rustc, base);
        }
    };
    let _ = fs::write(p.shadow_manifest.join(".functions"), functions.to_string());

    let relative_root = {
        let root = if unit.root.is_absolute() { unit.root.clone() } else { std::env::current_dir().unwrap_or_default().join(&unit.root) };
        root.strip_prefix(&p.manifest_dir).map(Path::to_path_buf).unwrap_or_default()
    };
    let mut args = base.to_vec();
    args[unit.root_index] = p.shadow_manifest.join(relative_root).to_string_lossy().into_owned();
    args.push("--extern".into());
    args.push(format!("flowtrace={}", p.rlib));
    // Last match wins, so this overrides any remap the build already carries.
    args.push("--remap-path-prefix".into());
    args.push(format!("{}={}", p.shadow_manifest.display(), p.manifest_dir.display()));
    let _ = rest;

    // Captured, not streamed: if the instrumented copy fails to build we retry the
    // original, and the user must see only the attempt that decides the outcome.
    let first = Command::new(rustc).args(&args).stdout(Stdio::piped()).stderr(Stdio::piped()).output();
    match first {
        Ok(out) if out.status.success() => {
            replay(&out.stdout, &out.stderr);
            restore_dep_info(&args, &p.shadow_manifest, &p.manifest_dir);
            ExitCode::SUCCESS
        }
        Ok(first) => {
            let second = Command::new(rustc).args(base).stdout(Stdio::piped()).stderr(Stdio::piped()).output();
            match second {
                Ok(out) if out.status.success() => {
                    let why = String::from_utf8_lossy(&first.stderr);
                    eprintln!("[flowtrace] warning: {} did not compile with instrumentation, so it was built without; it will not appear in the trace.", unit.crate_name);
                    if let Some(line) = why.lines().find(|l| l.contains("\"message\"") || l.starts_with("error")) {
                        eprintln!("[flowtrace]   rustc said: {}", line.chars().take(300).collect::<String>());
                    }
                    replay(&out.stdout, &out.stderr);
                    ExitCode::SUCCESS
                }
                // Both fail: the error is the user's, so show the one with their paths.
                Ok(out) => {
                    replay(&out.stdout, &out.stderr);
                    exit_code(out.status.code())
                }
                Err(e) => {
                    eprintln!("[flowtrace] cannot run {rustc}: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Err(e) => {
            eprintln!("[flowtrace] cannot run {rustc}: {e}");
            ExitCode::from(1)
        }
    }
}

fn replay(stdout: &[u8], stderr: &[u8]) {
    use std::io::Write;
    let _ = std::io::stdout().write_all(stdout);
    let _ = std::io::stderr().write_all(stderr);
}

/// `<out-dir>/<crate-name><extra-filename>.d`, with shadow paths mapped back.
fn restore_dep_info(args: &[String], shadow: &Path, original: &Path) {
    let value = |flag: &str| -> Option<String> {
        args.iter().enumerate().find_map(|(i, a)| (a == flag).then(|| args.get(i + 1).cloned()).flatten())
    };
    let (Some(out_dir), Some(name)) = (value("--out-dir"), value("--crate-name")) else { return };
    let extra = args
        .iter()
        .enumerate()
        .find_map(|(i, a)| {
            a.strip_prefix("-Cextra-filename=")
                .map(str::to_owned)
                .or_else(|| (a == "-C").then(|| args.get(i + 1)).flatten().and_then(|v| v.strip_prefix("extra-filename=").map(str::to_owned)))
        })
        .unwrap_or_default();
    let d = Path::new(&out_dir).join(format!("{name}{extra}.d"));
    if let Ok(text) = fs::read_to_string(&d) {
        let fixed = text.replace(&shadow.to_string_lossy().into_owned(), &original.to_string_lossy());
        if fixed != text {
            let _ = fs::write(&d, fixed);
        }
    }
}

// ---- the shadow tree -------------------------------------------------------

/// Rewrites a file only when its content changes, atomically: cargo may run the
/// lib and test units of one package at once, and they share this tree. The same
/// rewrite is deterministic, so a racing writer replaces a file with equal bytes.
fn write_if_changed(path: &Path, content: &[u8]) -> std::io::Result<()> {
    if fs::read(path).is_ok_and(|old| old == content) {
        return Ok(());
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
}

#[cfg(unix)]
fn link(original: &Path, at: &Path) -> std::io::Result<()> {
    if fs::read_link(at).is_ok_and(|t| t == original) {
        return Ok(());
    }
    let _ = fs::remove_file(at);
    match std::os::unix::fs::symlink(original, at) {
        // Lost a race to an identical link.
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        other => other,
    }
}

#[cfg(not(unix))]
fn link(_: &Path, _: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("instrumenting Rust needs symlinks; only Unix is supported"))
}

fn sync_shadow(p: &Planned) -> Result<usize, String> {
    let err = |e: std::io::Error| e.to_string();
    fs::create_dir_all(&p.shadow_manifest).map_err(err)?;
    // Everything beside src/ is reached through a link, so relative lookups out
    // of src/ (`include_str!("../README.md")`) land on the real files.
    for entry in fs::read_dir(&p.manifest_dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name();
        if matches!(name.to_str(), Some("src" | "target" | ".git" | ".flowtrace")) {
            continue;
        }
        link(&entry.path(), &p.shadow_manifest.join(&name)).map_err(err)?;
    }
    let mut total = 0;
    mirror(&p.manifest_dir.join("src"), &p.shadow_manifest.join("src"), &[], p, &mut total)?;
    Ok(total)
}

fn mirror(from: &Path, to: &Path, module: &[String], p: &Planned, total: &mut usize) -> Result<(), String> {
    let err = |e: std::io::Error| format!("{}: {e}", from.display());
    fs::create_dir_all(to).map_err(err)?;
    let mut entries: Vec<_> = fs::read_dir(from).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let name: OsString = entry.file_name();
        let (src, dst) = (entry.path(), to.join(&name));
        let kind = entry.file_type().map_err(err)?;
        let name_s = name.to_string_lossy();
        if kind.is_dir() {
            let mut child = module.to_vec();
            child.push(name_s.to_string());
            mirror(&src, &dst, &child, p, total)?;
        } else if name_s.ends_with(".rs") {
            let stem = name_s.trim_end_matches(".rs");
            // lib.rs / main.rs at the top are the crate root; mod.rs is named by its directory.
            let mut file_module = module.to_vec();
            match stem {
                "mod" => {}
                "lib" | "main" if module.is_empty() => {}
                _ => file_module.push(stem.to_owned()),
            }
            let text = fs::read_to_string(&src).map_err(err)?;
            // `src` is the original file: the shadow copy at `dst` is never named in a trace.
            let file = p.source_root.as_deref().map(|root| source_file(root, &src));
            let opts = Options { package: &p.package, file_module, prefix: &p.prefix, file: file.as_deref() };
            let out = match rewrite::instrument(&text, &opts) {
                Ok(r) => {
                    *total += r.functions;
                    if r.skipped_inline > 0 {
                        eprintln!(
                            "[flowtrace] note: {}: {} function(s) with code on the same line as their braces are not traced (instrumenting them would shift panic columns); run rustfmt",
                            src.display(),
                            r.skipped_inline
                        );
                    }
                    r.text
                }
                // A file syn cannot parse is passed through; rustc will say why.
                Err(_) => text,
            };
            write_if_changed(&dst, out.as_bytes()).map_err(err)?;
        } else {
            link(&src, &dst).map_err(err)?;
        }
    }
    Ok(())
}

/// `path`, an original source file, as the trace's `file` field carries it: a
/// POSIX path relative to `root`, or an absolute one for a file outside `root`
/// (a `../` chain could only be resolved by a reader who knows the root).
///
/// Compared as written first, then with symlinks resolved: cargo reports a
/// workspace under a symlinked directory by one spelling and a root typed by the
/// user may use the other, which must not turn every path absolute.
pub fn source_file(root: &Path, path: &Path) -> String {
    let posix = |p: &Path| p.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
    if let Ok(rel) = path.strip_prefix(root) {
        if !rel.as_os_str().is_empty() {
            return posix(rel);
        }
    }
    if let (Ok(real_root), Ok(real_path)) = (fs::canonicalize(root), fs::canonicalize(path)) {
        if let Ok(rel) = real_path.strip_prefix(&real_root) {
            if !rel.as_os_str().is_empty() {
                return posix(rel);
            }
        }
    }
    posix(path)
}

/// How many functions the wrappers instrumented, summed over every package.
pub fn count_instrumented(shadow: &Path) -> usize {
    fs::read_dir(shadow)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| fs::read_to_string(e.path().join(".functions")).ok())
        .filter_map(|s| s.trim().parse::<usize>().ok())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::source_file;
    use std::path::Path;

    #[test]
    fn a_file_under_the_root_is_relative_with_forward_slashes() {
        assert_eq!(source_file(Path::new("/ws"), Path::new("/ws/crates/core/src/wal/log.rs")), "crates/core/src/wal/log.rs");
        assert_eq!(source_file(Path::new("/ws/"), Path::new("/ws/src/main.rs")), "src/main.rs");
    }

    #[test]
    fn a_file_outside_the_root_stays_absolute() {
        assert_eq!(source_file(Path::new("/ws"), Path::new("/elsewhere/src/lib.rs")), "/elsewhere/src/lib.rs");
        // A sibling whose name merely starts with the root's is outside it.
        assert_eq!(source_file(Path::new("/ws"), Path::new("/ws-other/src/lib.rs")), "/ws-other/src/lib.rs");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_still_yields_a_relative_path() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir_all(real.join("src")).unwrap();
        std::fs::write(real.join("src/lib.rs"), "").unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(source_file(&link, &real.join("src/lib.rs")), "src/lib.rs");
    }
}
