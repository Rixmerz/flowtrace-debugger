//! The layer, driven by real `tracing` spans and `#[instrument]`. One process, one
//! trace file; each test filters by its own span names.

use flowtrace_tracing::FlowtraceLayer;
use serde_json::Value;
use std::sync::Once;
use tracing::instrument;
use tracing_subscriber::prelude::*;

fn setup() -> std::path::PathBuf {
    static ONCE: Once = Once::new();
    let path = std::env::temp_dir().join(format!("flowtrace-layer-{}.jsonl", std::process::id()));
    ONCE.call_once(|| {
        let _ = std::fs::remove_file(&path);
        std::env::set_var("FLOWTRACE_OUTPUT", &path);
        std::env::set_var("FLOWTRACE_MAX_ARG_LENGTH", "64");
        std::env::set_var("FLOWTRACE_MAX_EVENTS", "0");
    });
    path
}

fn events(prefix: &str) -> Vec<Value> {
    let path = setup();
    // Other test threads write to this file concurrently: a plain read can end mid-line.
    flowtrace::__rt::read_complete_lines(&path)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|e| e["method"].as_str().is_some_and(|m| m.starts_with(prefix)))
        .collect()
}

fn traced<T>(f: impl FnOnce() -> T) -> T {
    setup();
    tracing::subscriber::with_default(tracing_subscriber::registry().with(FlowtraceLayer::new()), f)
}

#[instrument]
fn lt_outer(n: i32, name: &str, password: &str) -> i32 {
    lt_inner(n) + 1
}

#[instrument(ret)]
fn lt_inner(n: i32) -> i32 {
    n * 2
}

#[derive(Debug)]
struct Boom;
impl std::fmt::Display for Boom {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "it broke")
    }
}

#[instrument(err)]
fn lt_fails() -> Result<u8, Boom> {
    Err(Boom)
}

#[instrument]
fn lt_panics() {
    panic!("layer boom");
}

#[test]
fn spans_become_enter_and_exit_with_args_ids_and_depth() {
    traced(|| lt_outer(3, "x", "hunter2"));
    let ev = events("lt_outer");
    assert_eq!(ev.len(), 2);
    assert_eq!(ev[0]["event"], "enter");
    assert_eq!(ev[0]["lang"], "rust");
    assert_eq!(ev[0]["module"], "layer");
    assert_eq!(ev[0]["visibility"], "unknown");
    assert_eq!(ev[0]["args"]["n"], 3);
    assert_eq!(ev[0]["args"]["name"], "x");
    assert_eq!(ev[0]["args"]["password"], "<redacted>");
    assert_eq!(ev[0]["parent_id"], Value::Null);

    let inner = events("lt_inner");
    assert_eq!(inner[0]["parent_id"], ev[0]["span_id"]);
    assert_eq!(inner[0]["trace_id"], ev[0]["trace_id"]);
    assert_eq!(inner[0]["depth"], 1);
    assert_eq!(inner[1]["result"], serde_json::json!({"r0": 6}), "#[instrument(ret)] becomes the result");
    assert_eq!(ev[1]["span_id"], ev[0]["span_id"]);
    assert!(ev[1]["duration_ns"].as_u64().is_some());
    assert_eq!(ev[1]["result"], serde_json::json!({}));
}

#[test]
fn instrument_err_becomes_the_exit_error() {
    let _ = traced(lt_fails);
    let ev = events("lt_fails");
    assert_eq!(ev[1]["error"]["msg"], "it broke");
    assert_eq!(ev[1]["error"]["type"], "error");
    assert_eq!(ev[1]["result"], serde_json::json!({}));
}

#[test]
fn a_panic_is_the_exit_error_of_every_span_it_unwinds_through() {
    let caught = traced(|| std::panic::catch_unwind(lt_panics));
    assert!(caught.is_err());
    let ev = events("lt_panics");
    assert_eq!(ev[1]["error"]["type"], "panic");
    assert_eq!(ev[1]["error"]["msg"], "layer boom");
}

#[test]
fn a_span_that_is_never_entered_writes_nothing() {
    traced(|| {
        let _unused = tracing::info_span!("lt_never_entered");
    });
    assert!(events("lt_never_entered").is_empty());
}

mod inner {
    use tracing::instrument;

    #[instrument]
    pub fn lp_kept_a() {
        super::lp_dropped_mid();
    }

    #[instrument]
    pub fn lp_kept_b() {}
}

#[instrument]
fn lp_dropped_top() {
    inner::lp_kept_a();
}

#[instrument]
fn lp_dropped_mid() {
    inner::lp_kept_b();
}

#[test]
fn the_prefix_drops_spans_and_reparents_their_children_to_the_nearest_kept_ancestor() {
    setup();
    let layer = FlowtraceLayer::new().with_prefix("layer::inner");
    tracing::subscriber::with_default(tracing_subscriber::registry().with(layer), lp_dropped_top);
    assert!(events("lp_dropped").is_empty(), "spans outside the prefix write nothing");
    let (a, b) = (events("lp_kept_a"), events("lp_kept_b"));
    assert_eq!(a[0]["parent_id"], Value::Null, "its parent was dropped, so it is a root");
    assert_eq!(b[0]["parent_id"], a[0]["span_id"], "kept_b skips the dropped span above it");
    assert_eq!(b[0]["depth"], 1);
}
