//! Proves a Rust process joins a trace that Python started.
//!
//! This cannot be a golden fixture: the golden normaliser rewrites every
//! `trace_id` to one constant, so a fixture would look the same whether or not the
//! hop correlated. The property lives in the raw ids, so it is asserted here, on
//! two real processes: the Python capture layer around `Gateway.call_storage`, and
//! a Rust binary built by `flowtrace-rust` that it spawns with
//! `FLOWTRACE_TRACEPARENT=current_traceparent()`.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn repo_root() -> PathBuf {
    manifest().join("../../..").canonicalize().unwrap()
}

fn read(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// Builds the callee under the driver and returns its binary.
fn build_callee(target: &Path) -> PathBuf {
    let dir = manifest().join("tests/xproc/callee");
    let status = Command::new(env!("CARGO_BIN_EXE_flowtrace-rust"))
        .args(["--dir", dir.to_str().unwrap(), "--capture-dir", manifest().join("..").to_str().unwrap(), "cargo", "build", "--quiet"])
        .env("CARGO_TARGET_DIR", target)
        .status()
        .expect("driver runs");
    assert!(status.success(), "building the callee failed");
    let build = std::fs::read_dir(target)
        .unwrap()
        .flatten()
        .find(|e| e.file_name().to_string_lossy().starts_with("flowtrace-"))
        .expect("the instrumented build directory");
    build.path().join("build/debug/callee")
}

/// Runs `caller.py` under the Python capture layer; returns (python events, rust events).
fn hop(binary: &Path, dir: &Path, propagate: bool) -> (Vec<Value>, Vec<Value>) {
    let (py_out, rust_out) = (dir.join("python.jsonl"), dir.join("rust.jsonl"));
    let python = repo_root().join("capture/python");
    let status = Command::new("python3")
        .arg(manifest().join("tests/xproc/caller.py"))
        .args([binary.to_str().unwrap(), rust_out.to_str().unwrap(), if propagate { "propagate" } else { "isolate" }])
        .env("PYTHONPATH", format!("{}:{}", python.join("stub").display(), python.display()))
        .env("FLOWTRACE_ENABLE", "1")
        .env("FLOWTRACE_PACKAGE_PREFIX", "caller")
        .env("FLOWTRACE_OUTPUT", &py_out)
        .status()
        .expect("python3 is needed for this test");
    assert!(status.success(), "the Python caller failed");
    (read(&py_out), read(&rust_out))
}

#[test]
fn a_rust_process_joins_the_trace_python_started() {
    let scratch = tempfile::tempdir().unwrap();
    let binary = build_callee(&scratch.path().join("target"));
    let (py, rust) = hop(&binary, scratch.path(), true);

    let call = py.iter().find(|e| e["method"] == "call_storage" && e["event"] == "enter").expect("python span");
    assert_eq!(call["lang"], "python");
    assert!(rust.iter().all(|e| e["lang"] == "rust"));
    assert_eq!(rust.len(), 6, "handle -> lookup, enter and exit each");

    // The point: one trace_id across the two languages...
    assert!(rust.iter().all(|e| e["trace_id"] == call["trace_id"]), "rust adopted python's trace_id");
    // ...and one tree: the Rust root hangs off the Python span that made the call.
    let root = &rust[0];
    assert_eq!(root["method"], "main");
    assert_eq!(root["parent_id"], call["span_id"]);
    assert_eq!(root["depth"], 0, "the remote span is not ours to emit: first local span is depth 0");
    let handle = rust.iter().find(|e| e["method"] == "handle" && e["event"] == "enter").unwrap();
    assert_eq!(handle["parent_id"], root["span_id"]);
    assert_eq!(handle["depth"], 1);
}

#[test]
fn without_a_traceparent_rust_starts_its_own_trace() {
    // The control: proves the match above is the hop's doing, not a coincidence.
    let scratch = tempfile::tempdir().unwrap();
    let binary = build_callee(&scratch.path().join("target"));
    let (py, rust) = hop(&binary, scratch.path(), false);
    let call = py.iter().find(|e| e["method"] == "call_storage").unwrap();
    assert_ne!(rust[0]["trace_id"], call["trace_id"]);
    assert_eq!(rust[0]["parent_id"], Value::Null);
}
