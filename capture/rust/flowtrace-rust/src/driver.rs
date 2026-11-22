//! Driver mode: prepare the instrumented build and hand it to cargo.

use crate::wrap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const SUBCOMMANDS: &[&str] = &["run", "build", "test"];

struct Cli {
    dir: PathBuf,
    capture_dir: PathBuf,
    prefix: Option<String>,
    cargo: Vec<String>,
}

fn usage() -> ExitCode {
    eprintln!("usage: flowtrace-rust [--dir DIR] [--capture-dir DIR] [--package-prefix P] cargo run|build|test [args...]");
    ExitCode::from(2)
}

fn parse(args: &[String]) -> Result<Cli, String> {
    let mut cli = Cli {
        dir: PathBuf::from("."),
        // capture/rust, when run from a checkout: this crate sits one level below.
        capture_dir: Path::new(env!("CARGO_MANIFEST_DIR")).join(".."),
        prefix: std::env::var(wrap::ENV_PREFIX).ok().filter(|p| !p.is_empty()),
        cargo: Vec::new(),
    };
    let mut it = args.iter().peekable();
    while let Some(a) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--dir" => cli.dir = PathBuf::from(value("--dir")?),
            "--capture-dir" => cli.capture_dir = PathBuf::from(value("--capture-dir")?),
            "--package-prefix" => cli.prefix = Some(value("--package-prefix")?),
            "--" => {}
            _ => {
                cli.cargo.push(a.clone());
                cli.cargo.extend(it.by_ref().cloned());
            }
        }
    }
    Ok(cli)
}

/// What `cargo metadata` says about the workspace.
struct Workspace {
    target_directory: PathBuf,
    /// `(package, module root)` per workspace package, both with `-` as `_`. The
    /// root is what the code is called in a Rust path: the library target's name
    /// (`kerno_storage` for the package `kernodb-storage`), else the package's.
    packages: Vec<(String, String)>,
}

fn metadata(dir: &Path, toolchain: Option<&str>) -> Result<Workspace, String> {
    let mut cmd = Command::new("cargo");
    cmd.args(toolchain);
    let out = cmd
        .args(["metadata", "--no-deps", "--format-version", "1"])
        .current_dir(dir)
        .env("RUSTC_WRAPPER", "")
        .output()
        .map_err(|e| format!("cannot run cargo: {e}"))?;
    if !out.status.success() {
        return Err(format!("cargo metadata failed:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let members: Vec<&str> = v["workspace_members"].as_array().into_iter().flatten().filter_map(|m| m.as_str()).collect();
    let packages = v["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["id"].as_str().is_some_and(|id| members.contains(&id)))
        .filter_map(|p| {
            let name = p["name"].as_str()?.replace('-', "_");
            let lib = p["targets"].as_array().into_iter().flatten().find_map(|t| {
                let is_lib = t["kind"].as_array()?.iter().any(|k| matches!(k.as_str(), Some("lib" | "rlib" | "dylib" | "cdylib" | "staticlib")));
                is_lib.then(|| t["name"].as_str().map(|n| n.replace('-', "_"))).flatten()
            });
            Some((name.clone(), lib.unwrap_or(name)))
        })
        .collect();
    Ok(Workspace {
        target_directory: PathBuf::from(v["target_directory"].as_str().ok_or("cargo metadata has no target_directory")?),
        packages,
    })
}

/// The prefix that selects the workspace's own crates: the module root of a
/// single package, otherwise the longest common prefix of the members' roots
/// (`kerno_core`, `kerno_storage` -> `kerno`). Without one the trace would hold
/// only what the user typed, or everything.
fn detect_prefix(packages: &[String]) -> String {
    let Some(first) = packages.first() else { return String::new() };
    if packages.len() == 1 {
        return first.clone();
    }
    let mut common = first.clone();
    for p in &packages[1..] {
        let n = common.chars().zip(p.chars()).take_while(|(a, b)| a == b).count();
        common = common.chars().take(n).collect();
    }
    // The overlap must end at a word boundary in at least one name, or it is
    // `app_c` for `app_core` and `app_cli`: cut back to the last `_`.
    let at_boundary = packages.iter().any(|p| matches!(p[common.len()..].chars().next(), None | Some('_')));
    let common = if at_boundary { common } else { common.rsplit_once('_').map_or(String::new(), |(head, _)| head.to_owned()) };
    let common = common.trim_end_matches('_').to_owned();
    // A one- or two-letter overlap says nothing about the project.
    if common.len() >= 3 { common } else { String::new() }
}

fn short_hash(parts: &[&str]) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    parts.hash(&mut h);
    format!("{:08x}", h.finish() as u32)
}

pub fn run(args: &[String]) -> ExitCode {
    match drive(args) {
        Ok(code) => code,
        Err(msg) => {
            eprintln!("[flowtrace] error: {msg}");
            ExitCode::from(1)
        }
    }
}

fn drive(args: &[String]) -> Result<ExitCode, String> {
    let cli = parse(args)?;
    // `cargo +nightly run`: the runtime must be built by the same toolchain.
    let toolchain = cli.cargo.get(1).filter(|a| a.starts_with('+')).cloned();
    let sub_at = if toolchain.is_some() { 2 } else { 1 };
    let ok = cli.cargo.first().is_some_and(|c| Path::new(c).file_stem().is_some_and(|s| s == "cargo"))
        && cli.cargo.get(sub_at).is_some_and(|s| SUBCOMMANDS.contains(&s.as_str()));
    if !ok {
        eprintln!("[flowtrace] error: flowtrace instruments `cargo run`, `cargo build` or `cargo test` — not an already-built binary, which has nothing left to splice into.");
        return Ok(usage());
    }
    if cli.cargo.iter().any(|a| a == "--target" || a.starts_with("--target=")) {
        return Err("--target is not supported: the runtime is built for the host. Trace a host build.".into());
    }
    if !cfg!(unix) {
        return Err("only Unix hosts are supported (the instrumented tree is made of symlinks)".into());
    }

    let ws = metadata(&cli.dir, toolchain.as_deref())?;
    let roots: Vec<String> = ws.packages.iter().map(|(_, root)| root.clone()).collect();
    let prefix = cli.prefix.clone().unwrap_or_else(|| detect_prefix(&roots));
    // The wrapper learns each package's module root from here: it is only told the package.
    let module_roots = ws.packages.iter().map(|(p, r)| format!("{p}={r}")).collect::<Vec<_>>().join(";");
    let target = std::env::var_os("CARGO_TARGET_DIR").map(PathBuf::from).unwrap_or(ws.target_directory);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_stamp = std::fs::metadata(&exe)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    // One build directory per (prefix, wrapper build). Cargo's fingerprints do not
    // know the wrapper or the prefix changed, so reusing a directory across
    // either would serve a stale, differently-instrumented artifact.
    let build = target.join(format!("flowtrace-{}", short_hash(&[&prefix, &exe_stamp.to_string()])));
    std::fs::create_dir_all(&build).map_err(|e| format!("{}: {e}", build.display()))?;

    let rt_dir = build_runtime(&cli.capture_dir, &build, toolchain.as_deref())?;
    let shadow = build.join("shadow");
    let rlib = rt_dir.join("libflowtrace.rlib");

    eprintln!("[flowtrace] prefix {}", if prefix.is_empty() { "(none: every workspace crate)" } else { &prefix });

    let mut cmd = Command::new(&cli.cargo[0]);
    cmd.args(&cli.cargo[1..])
        .current_dir(&cli.dir)
        .env("CARGO_TARGET_DIR", build.join("build"))
        // sccache, when configured, would sit in front of the wrapper and cache the
        // uninstrumented artifact under the instrumented one's name.
        .env("RUSTC_WRAPPER", "")
        .env("RUSTC_WORKSPACE_WRAPPER", &exe)
        .env(wrap::ENV_MODE, "1")
        .env(wrap::ENV_RLIB, &rlib)
        .env(wrap::ENV_RT_DIR, &rt_dir)
        .env(wrap::ENV_SHADOW, &shadow)
        .env(wrap::ENV_PREFIX, &prefix)
        .env(wrap::ENV_ROOTS, &module_roots);
    // Doc tests are compiled by rustdoc, which the rustc wrapper never sees.
    let rustdocflags = std::env::var("RUSTDOCFLAGS").unwrap_or_default();
    cmd.env("RUSTDOCFLAGS", format!("{rustdocflags} -L dependency={}", rt_dir.display()));

    let status = cmd.status().map_err(|e| format!("cannot run {}: {e}", cli.cargo[0]))?;

    // An empty trace is the failure that looks like success: say so loudly.
    let n = wrap::count_instrumented(&shadow);
    if n == 0 {
        eprintln!("[flowtrace] warning: no function was instrumented, so the trace will be empty. The prefix {prefix:?} matched no workspace crate; pass --package-prefix <crate name prefix>.");
    } else {
        eprintln!("[flowtrace] instrumented {n} functions");
    }
    Ok(ExitCode::from(status.code().map_or(1, |c| u8::try_from(c).unwrap_or(1))))
}

/// Builds the runtime rlib with the user's toolchain; returns the directory
/// holding `libflowtrace.rlib`. Cargo makes a rebuild a no-op.
fn build_runtime(capture_dir: &Path, build: &Path, toolchain: Option<&str>) -> Result<PathBuf, String> {
    let manifest = capture_dir.join("Cargo.toml");
    if !manifest.exists() {
        return Err(format!("{} not found; pass --capture-dir <path to capture/rust>", manifest.display()));
    }
    let target = build.join("runtime");
    let mut cmd = Command::new("cargo");
    cmd.args(toolchain)
        .args(["build", "--release", "--quiet", "-p", "flowtrace", "--manifest-path"])
        .arg(&manifest)
        .arg("--target-dir")
        .arg(&target)
        .env("RUSTC_WRAPPER", "")
        .env_remove("RUSTC_WORKSPACE_WRAPPER");
    let status = cmd.status().map_err(|e| format!("cannot run cargo: {e}"))?;
    if !status.success() {
        return Err("building the flowtrace runtime failed".into());
    }
    Ok(target.join("release"))
}

#[cfg(test)]
mod tests {
    use super::detect_prefix;

    fn names(n: &[&str]) -> Vec<String> {
        n.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn a_single_package_is_its_own_prefix() {
        assert_eq!(detect_prefix(&names(&["calc"])), "calc");
    }

    #[test]
    fn a_workspace_uses_the_common_prefix() {
        assert_eq!(detect_prefix(&names(&["kerno_core", "kerno_storage", "kerno_units"])), "kerno");
        assert_eq!(detect_prefix(&names(&["app_core", "app_cli"])), "app");
    }

    #[test]
    fn an_accidental_overlap_means_no_filter() {
        assert_eq!(detect_prefix(&names(&["alpha", "arc"])), "");
        assert_eq!(detect_prefix(&[]), "");
    }
}
