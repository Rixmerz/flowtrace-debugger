//! The event cap only ever stops *new* spans from opening. A span whose `enter`
//! was written always gets its `exit`: an `enter` with no `exit` is what every
//! consumer reads as "this call never returned", so the cap must not forge it.

use flowtrace::__rt::{enter, Meta};
use serde_json::Value;

static M: Meta = Meta::new("cap", "", "f", "public");

#[test]
fn the_cap_never_leaves_an_enter_without_its_exit() {
    let out = std::env::temp_dir().join(format!("flowtrace-cap-{}.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&out);
    std::env::set_var("FLOWTRACE_OUTPUT", &out);
    std::env::set_var("FLOWTRACE_MAX_EVENTS", "3");

    let a = enter(&M, &mut |_| {}); // event 1
    let b = enter(&M, &mut |_| {}); // event 2
    let c = enter(&M, &mut |_| {}); // event 3 -> cap reached
    let d = enter(&M, &mut |_| {}); // refused: inert guard
    d.finish(&mut |_| {});
    c.finish(&mut |_| {});
    b.finish(&mut |_| {});
    a.finish(&mut |_| {});
    flowtrace::flush();

    let ev: Vec<Value> = std::fs::read_to_string(&out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let enters = ev.iter().filter(|e| e["event"] == "enter").count();
    let exits = ev.iter().filter(|e| e["event"] == "exit").count();
    assert_eq!(enters, 3, "the fourth span was refused");
    assert_eq!(exits, 3, "every written enter has its exit, past the cap");
    let _ = std::fs::remove_file(&out);
}
