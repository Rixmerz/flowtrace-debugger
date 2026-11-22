//! Builds `tests/corpus` through the real driver and checks the instrumented
//! build is the one that ran: the driver deliberately falls back to an
//! uninstrumented crate when rustc rejects the spliced source, so a rewriter
//! regression would otherwise show up as nothing but a thinner trace.

use std::path::PathBuf;
use std::process::Command;

fn capture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

#[test]
fn every_function_shape_still_compiles_instrumented() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let scratch = tempfile::tempdir().unwrap();
    let out = scratch.path().join("trace.jsonl");

    let run = Command::new(env!("CARGO_BIN_EXE_flowtrace-rust"))
        .args(["--dir", dir.to_str().unwrap(), "--capture-dir", capture_dir().to_str().unwrap(), "cargo", "run", "--quiet"])
        .env("CARGO_TARGET_DIR", scratch.path().join("target"))
        .env("FLOWTRACE_OUTPUT", &out)
        .output()
        .expect("driver runs");
    let stderr = String::from_utf8_lossy(&run.stderr);

    assert!(run.status.success(), "the corpus program failed:\n{stderr}");
    assert!(!stderr.contains("did not compile with instrumentation"), "rustc rejected spliced source:\n{stderr}");

    let trace = std::fs::read_to_string(&out).expect("trace written");
    for must in [
        "\"method\":\"twice\"", "\"method\":\"first_mut\"", "\"method\":\"pick\"", "\"method\":\"fib\"",
        "\"method\":\"exported\"", "\"method\":\"describe\"", "\"method\":\"raw\"", "\"method\":\"r#match\"",
    ] {
        // r#match is emitted without the raw-identifier prefix.
        let must = must.replace("r#", "");
        assert!(trace.contains(&must), "missing {must} in trace");
    }
    // The shapes that must NOT be instrumented.
    for must_not in ["\"method\":\"constant\"", "\"method\":\"asynchronous\"", "\"method\":\"forced\"", "\"method\":\"located\"", "\"method\":\"t\"", "\"method\":\"fmt\""] {
        assert!(!trace.contains(must_not), "{must_not} must not be instrumented");
    }
    // The shapes only the guard can record still enter and exit.
    assert!(trace.contains("\"method\":\"iter\""));
}
