//! `FLOWTRACE_TRACEPARENT` is read once per process, so this is its own test
//! binary: it must set the variable before anything touches the runtime.

use flowtrace::__rt::probe::*;
use flowtrace::__rt::{enter, Meta};
use serde_json::Value;

static ROOT: Meta = Meta::new("seed", "", "root", "public");
static CHILD: Meta = Meta::new("seed", "", "child", "private");

#[test]
fn a_process_launched_under_a_traceparent_joins_that_trace() {
    let out = std::env::temp_dir().join(format!("flowtrace-seed-{}.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&out);
    std::env::set_var("FLOWTRACE_OUTPUT", &out);
    std::env::set_var("FLOWTRACE_TRACEPARENT", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");

    let g = enter(&ROOT, &mut |_| {});
    let c = enter(&CHILD, &mut |a| a.arg("n", &mut |o| (&&__FtP(&1u8)).ft_arg(o)));
    c.finish(&mut |_| {});
    g.finish(&mut |_| {});
    // A second root in the same process joins the same trace.
    enter(&ROOT, &mut |_| {}).finish(&mut |_| {});
    flowtrace::flush();

    let ev: Vec<Value> = std::fs::read_to_string(&out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(ev.len(), 6);
    assert!(ev.iter().all(|e| e["trace_id"] == "4bf92f3577b34da6a3ce929d0e0e4736"));
    assert_eq!(ev[0]["parent_id"], "00f067aa0ba902b7", "the first local span hangs off the remote span");
    assert_eq!(ev[0]["depth"], 0);
    assert_eq!(ev[1]["parent_id"], ev[0]["span_id"]);
    assert_eq!(ev[1]["depth"], 1);
    assert_eq!(ev[4]["parent_id"], "00f067aa0ba902b7");
    assert_eq!(ev[4]["depth"], 0);
    let _ = std::fs::remove_file(&out);
}
