//! Trace and span ids, without a dependency.
//!
//! `RandomState` is seeded from the OS once per thread and gives every thread a
//! different key, which is all the entropy an id needs: these are correlation
//! keys, not secrets. Each thread then runs its own splitmix64 stream, so
//! minting an id touches no shared state and takes no lock.

use std::cell::Cell;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

/// W3C trace id: 128 bits, rendered as 32 lowercase hex characters.
pub type TraceId = u128;
/// W3C span id: 64 bits, rendered as 16 lowercase hex characters.
pub type SpanId = u64;

thread_local! {
    static STATE: Cell<u64> = const { Cell::new(0) };
}

fn seed() -> u64 {
    let mut h = RandomState::new().build_hasher();
    h.write_u64(u64::from(std::process::id()));
    h.finish() | 1
}

fn next_u64() -> u64 {
    STATE.with(|s| {
        let mut x = s.get();
        if x == 0 {
            x = seed();
        }
        x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
        s.set(x);
        let mut z = x;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    })
}

/// A fresh trace id. Never all zero: W3C forbids it.
pub fn new_trace_id() -> TraceId {
    loop {
        let id = (u128::from(next_u64()) << 64) | u128::from(next_u64());
        if id != 0 {
            return id;
        }
    }
}

/// A fresh span id. Never all zero: W3C forbids it.
pub fn new_span_id() -> SpanId {
    loop {
        let id = next_u64();
        if id != 0 {
            return id;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_are_nonzero_and_distinct() {
        let spans: HashSet<_> = (0..10_000).map(|_| new_span_id()).collect();
        assert_eq!(spans.len(), 10_000);
        assert!(spans.iter().all(|s| *s != 0));
        assert_ne!(new_trace_id(), new_trace_id());
    }

    #[test]
    fn threads_do_not_share_a_stream() {
        let a = std::thread::spawn(|| (0..100).map(|_| new_span_id()).collect::<Vec<_>>());
        let b = std::thread::spawn(|| (0..100).map(|_| new_span_id()).collect::<Vec<_>>());
        let (a, b) = (a.join().unwrap(), b.join().unwrap());
        assert!(a.iter().all(|x| !b.contains(x)));
    }
}
