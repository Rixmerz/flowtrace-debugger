//! Runtime tests. They drive the API exactly as the spliced code does, through
//! `enter` / `finish` and the probe ladders, and read the events back from the
//! file the sink wrote. All tests in this module share one process (and one
//! trace file), so each filters by the unique method names it registered.

use crate::__rt::probe::*;
use crate::__rt::{enter, Meta};
use serde_json::Value;
use std::sync::Once;

fn setup() -> std::path::PathBuf {
    static ONCE: Once = Once::new();
    let path = std::env::temp_dir().join(format!("flowtrace-unit-{}.jsonl", std::process::id()));
    ONCE.call_once(|| {
        let _ = std::fs::remove_file(&path);
        std::env::set_var("FLOWTRACE_OUTPUT", &path);
        std::env::set_var("FLOWTRACE_MAX_ARG_LENGTH", "64");
        std::env::set_var("FLOWTRACE_MAX_EVENTS", "0");
    });
    path
}

/// Events whose `method` starts with `prefix`, in file order.
fn events(prefix: &str) -> Vec<Value> {
    let path = setup();
    crate::flush();
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).expect("every line is valid JSON"))
        .filter(|e| e["method"].as_str().is_some_and(|m| m.starts_with(prefix)))
        .collect()
}

macro_rules! meta {
    ($name:expr) => {{
        static M: Meta = Meta::new("unit", "T", $name, "public");
        &M
    }};
}

/// What the rewriter splices around a body: args, body in a closure, result.
macro_rules! traced {
    ($name:expr, [$(($arg:literal, $val:expr)),*], $ret:ty, $body:expr) => {{
        setup();
        let guard = enter(meta!($name), &mut |_a| { $( _a.arg($arg, &mut |o| (&&__FtP(&$val)).ft_arg(o)); )* });
        let r = (|| -> $ret { $body })();
        guard.finish(&mut |o| (&&&&&&&&&&&__FtP(&r)).ft_result(o));
        r
    }};
}

#[test]
fn nested_calls_link_parent_to_child() {
    let _ = traced!("nest_outer", [], (), {
        traced!("nest_inner", [], (), {});
    });
    let ev = events("nest_");
    assert_eq!(ev.len(), 4);
    let (oe, ie, ix, ox) = (&ev[0], &ev[1], &ev[2], &ev[3]);
    assert_eq!((oe["event"].as_str(), ie["event"].as_str(), ix["event"].as_str(), ox["event"].as_str()),
               (Some("enter"), Some("enter"), Some("exit"), Some("exit")));
    assert_eq!(oe["parent_id"], Value::Null);
    assert_eq!(ie["parent_id"], oe["span_id"]);
    assert_eq!(ie["trace_id"], oe["trace_id"]);
    assert_eq!((oe["depth"].as_u64(), ie["depth"].as_u64()), (Some(0), Some(1)));
    assert_eq!(ox["span_id"], oe["span_id"]);
    assert!(ox["duration_ns"].as_u64().is_some());
}

#[test]
fn events_have_exactly_the_v2_keys() {
    traced!("keys_fn", [("n", 1i32)], i32, 7);
    let ev = events("keys_fn");
    let enter_keys = ["ts", "trace_id", "span_id", "parent_id", "event", "thread", "lang", "module", "class", "method", "visibility", "args", "depth"];
    let mut exit_keys = enter_keys.to_vec();
    exit_keys.extend(["result", "duration_ns"]);
    for (e, want) in ev.iter().zip([&enter_keys[..], &exit_keys[..]]) {
        let mut got: Vec<_> = e.as_object().unwrap().keys().map(String::as_str).collect();
        let mut want = want.to_vec();
        got.sort_unstable();
        want.sort_unstable();
        assert_eq!(got, want);
        assert_eq!(e["lang"], "rust");
        assert_eq!(e["trace_id"].as_str().unwrap().len(), 32);
        assert_eq!(e["span_id"].as_str().unwrap().len(), 16);
    }
    assert_eq!(ev[1]["result"], serde_json::json!({"r0": 7}));
}

#[derive(Debug)]
#[allow(dead_code)]
struct Point {
    x: i32,
}
struct Opaque;

#[test]
fn arguments_use_the_best_available_rendering() {
    let s = String::from("hi \"there\"");
    let opaque = Opaque;
    traced!("args_fn", [("n", 42u8), ("f", 1.5f64), ("ok", true), ("s", s), ("p", Point { x: 3 }), ("o", opaque), ("v", vec![1, 2])], (), {});
    let args = &events("args_fn")[0]["args"];
    assert_eq!(args["n"], 42);
    assert_eq!(args["f"], 1.5);
    assert_eq!(args["ok"], true);
    assert_eq!(args["s"], "hi \"there\"");
    assert_eq!(args["p"], "Point { x: 3 }");
    assert_eq!(args["v"], "[1, 2]");
    assert!(args["o"].as_str().unwrap().contains("Opaque"));
}

#[test]
fn secrets_are_redacted_by_name_and_never_rendered() {
    struct Boom;
    impl std::fmt::Debug for Boom {
        fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            panic!("a redacted argument must not be formatted")
        }
    }
    traced!("redact_fn", [("db_password", Boom), ("API_KEY_ID", Boom)], (), {});
    let args = &events("redact_fn")[0]["args"];
    assert_eq!(args["db_password"], "<redacted>");
    assert_eq!(args["API_KEY_ID"], "<redacted>");
}

#[test]
fn nested_secrets_are_redacted_in_arguments_and_results() {
    #[derive(Debug)]
    #[allow(dead_code)]
    struct Login {
        user: String,
        password: String,
    }
    let login = Login { user: "ann".into(), password: "hunter2".into() };
    let _ = traced!("nested_redact", [("login", login)], Login, {
        Login { user: "bob".into(), password: "s3cret".into() }
    });
    let ev = events("nested_redact");
    for e in [&ev[0]["args"]["login"], &ev[1]["result"]["r0"]] {
        let s = e.as_str().unwrap();
        assert!(s.contains("password: \"<redacted>\""), "{s}");
        assert!(!s.contains("hunter2") && !s.contains("s3cret"), "{s}");
        assert!(s.contains("user: \""), "{s}");
    }
}

#[test]
fn long_values_are_truncated_per_the_shared_rule() {
    let long = "x".repeat(500);
    traced!("trunc_fn", [("s", long)], (), {});
    let s = events("trunc_fn")[0]["args"]["s"].as_str().unwrap().to_owned();
    assert!(s.starts_with("<truncated:\"xxx"), "{s}");
    assert!(s.ends_with("...>"));
}

#[derive(Debug)]
struct DisplayErr;
impl std::fmt::Display for DisplayErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("display message")
    }
}
#[derive(Debug)]
#[allow(dead_code)]
struct DebugOnlyErr(u8);
struct OpaqueErr;

#[test]
fn an_err_becomes_the_exit_error() {
    let _ = traced!("res_display", [], Result<i32, DisplayErr>, Err(DisplayErr));
    let _ = traced!("res_debug", [], Result<i32, DebugOnlyErr>, Err(DebugOnlyErr(9)));
    let _ = traced!("res_opaque", [], Result<i32, OpaqueErr>, Err(OpaqueErr));
    let _ = traced!("res_ok", [], Result<String, DisplayErr>, Ok("fine".to_owned()));
    let _ = traced!("res_ok_debug", [], Result<Point, DisplayErr>, Ok(Point { x: 1 }));
    let _ = traced!("res_unit", [], Result<(), DisplayErr>, Ok(()));

    let exit = |m: &str| events(m).remove(1);
    let e = exit("res_display");
    assert_eq!(e["error"]["msg"], "display message");
    assert!(e["error"]["type"].as_str().unwrap().ends_with("DisplayErr"));
    assert_eq!(e["error"]["stack"], serde_json::json!([]));
    assert_eq!(e["result"], serde_json::json!({}), "a failed call still carries `result`");
    assert_eq!(exit("res_debug")["error"]["msg"], "DebugOnlyErr(9)");
    assert!(exit("res_opaque")["error"]["msg"].as_str().unwrap().contains("not printable"));
    assert_eq!(exit("res_ok")["result"], serde_json::json!({"r0": "fine"}));
    assert_eq!(exit("res_ok_debug")["result"], serde_json::json!({"r0": "Point { x: 1 }"}));
    assert_eq!(exit("res_unit")["result"], serde_json::json!({}));
    assert!(exit("res_ok").get("error").is_none());
}

#[test]
fn plain_values_use_the_value_tiers() {
    let _ = traced!("val_int", [], u64, 5);
    let _ = traced!("val_opt", [], Option<i32>, Some(2));
    let _ = traced!("val_opaque", [], Opaque, Opaque);
    assert_eq!(events("val_int")[1]["result"], serde_json::json!({"r0": 5}));
    assert_eq!(events("val_opt")[1]["result"], serde_json::json!({"r0": "Some(2)"}));
    assert!(events("val_opaque")[1]["result"]["r0"].as_str().unwrap().contains("Opaque"));
}

#[test]
fn a_panic_closes_every_span_it_unwinds_through_and_restores_context() {
    let caught = std::panic::catch_unwind(|| {
        traced!("pan_outer", [], (), {
            traced!("pan_inner", [], (), {
                panic!("boom {}", 7);
            });
        });
    });
    assert!(caught.is_err());
    // After the catch, a new span is a fresh root: the context was unwound.
    traced!("pan_after", [], (), {});

    let ev = events("pan_");
    let inner = ev.iter().find(|e| e["method"] == "pan_inner" && e["event"] == "exit").unwrap();
    let outer = ev.iter().find(|e| e["method"] == "pan_outer" && e["event"] == "exit").unwrap();
    for e in [inner, outer] {
        assert_eq!(e["error"]["type"], "panic");
        assert_eq!(e["error"]["msg"], "boom 7");
        assert_eq!(e["result"], serde_json::json!({}));
        assert!(e["error"]["stack"][0].as_str().unwrap().starts_with("panicked at"));
    }
    let after = ev.iter().find(|e| e["method"] == "pan_after" && e["event"] == "enter").unwrap();
    assert_eq!(after["parent_id"], Value::Null);
    assert!(ev.iter().find(|e| e["method"] == "pan_after" && e["event"] == "exit").unwrap().get("error").is_none());
}

#[test]
fn remote_context_joins_a_callers_trace() {
    let header = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    {
        let _g = crate::remote_context(header).expect("valid header");
        traced!("rem_a", [], (), {
            traced!("rem_b", [], (), {});
        });
    }
    traced!("rem_after", [], (), {});
    let ev = events("rem_");
    let a = &ev[0];
    assert_eq!(a["trace_id"], "0af7651916cd43dd8448eb211c80319c");
    assert_eq!(a["parent_id"], "b7ad6b7169203331");
    assert_eq!(a["depth"], 0);
    assert_eq!(ev[1]["parent_id"], a["span_id"]);
    assert_eq!(ev[1]["depth"], 1);
    let after = ev.iter().find(|e| e["method"] == "rem_after").unwrap();
    assert_ne!(after["trace_id"], "0af7651916cd43dd8448eb211c80319c", "context restored on drop");
    assert!(crate::remote_context("garbage").is_none());
}

#[test]
fn current_traceparent_names_the_running_span() {
    assert!(crate::current_traceparent().is_none());
    let mut seen = None;
    traced!("tp_fn", [], (), { seen = crate::current_traceparent(); });
    let tp = seen.expect("inside a span");
    let e = &events("tp_fn")[0];
    assert_eq!(tp, format!("00-{}-{}-01", e["trace_id"].as_str().unwrap(), e["span_id"].as_str().unwrap()));
}

#[test]
fn a_debug_impl_that_calls_traced_code_does_not_recurse() {
    struct Chatty;
    impl std::fmt::Debug for Chatty {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            // Instrumented code reached from a value's own formatter.
            traced!("reent_fmt", [("x", Chatty)], (), {});
            f.write_str("chatty")
        }
    }
    traced!("reent_outer", [("c", Chatty)], (), {});
    assert_eq!(events("reent_outer")[0]["args"]["c"], "chatty");
    assert!(events("reent_fmt").is_empty(), "runtime-initiated calls are not traced");
}

#[test]
fn a_panicking_debug_impl_does_not_break_the_traced_call() {
    struct Bad;
    impl std::fmt::Debug for Bad {
        fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            panic!("bad debug")
        }
    }
    // The panic hook is process-global and the panic test below relies on ours: leave it alone.
    let out = traced!("bad_dbg", [("b", Bad)], i32, 11);
    assert_eq!(out, 11);
    assert!(events("bad_dbg")[0]["args"]["<error>"].as_str().unwrap().contains("panicked"));
}

#[test]
fn spans_on_new_threads_are_roots_with_their_own_thread_name() {
    traced!("thr_main", [], (), {
        std::thread::Builder::new().name("worker-x".into()).spawn(|| {
            traced!("thr_child", [], (), {});
        }).unwrap().join().unwrap();
    });
    let ev = events("thr_");
    let child = ev.iter().find(|e| e["method"] == "thr_child").unwrap();
    assert_eq!(child["thread"], "worker-x");
    assert_eq!(child["parent_id"], Value::Null, "no ambient context across threads");
}
