//! Times the three workloads and prints one line the harness parses. This crate
//! sits outside the instrumented prefix (`bench_lib`), so each call into the
//! library from here is a root span, and the loop itself costs nothing.

use bench_lib::{nested_batch, tiny, Store};
use std::hint::black_box;
use std::time::Instant;

const TINY_ROOT_CALLS: u64 = 1_000_000;
const TINY_NESTED_CALLS: u64 = 1_000_000;
const STORE_CALLS: u64 = 200_000;

fn ns_per(start: Instant, calls: u64) -> f64 {
    start.elapsed().as_nanos() as f64 / calls as f64
}

fn main() {
    let store = Store::new();
    // Warm-up, not measured.
    for i in 0..20_000 {
        black_box(tiny(black_box(i)));
        black_box(store.get(black_box(i)));
    }

    let t = Instant::now();
    let mut acc = 0u64;
    for i in 0..TINY_ROOT_CALLS {
        acc ^= tiny(black_box(i));
    }
    black_box(acc);
    let root = ns_per(t, TINY_ROOT_CALLS);

    let t = Instant::now();
    black_box(nested_batch(black_box(TINY_NESTED_CALLS)));
    let nested = ns_per(t, TINY_NESTED_CALLS);

    let t = Instant::now();
    let mut found = 0u64;
    for i in 0..STORE_CALLS {
        found += u64::from(store.get(black_box(i)).is_some());
    }
    black_box(found);
    let store_total = t.elapsed();
    let store_ns = store_total.as_nanos() as f64 / STORE_CALLS as f64;

    println!(
        "BENCH_RUST root_ns={root:.1} nested_ns={nested:.1} store_ns={store_ns:.1} store_ms={}",
        store_total.as_millis()
    );
}
