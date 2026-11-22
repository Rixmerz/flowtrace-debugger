//! The code under measurement. `#[inline(never)]` everywhere: without it the
//! baseline inlines these to nothing and every "overhead" figure is really the
//! cost of a call the plain build never makes.

use std::collections::HashMap;

/// The cheapest possible traced function: the span costs far more than the work.
/// This is the worst case, not a representative one.
#[inline(never)]
pub fn tiny(x: u64) -> u64 {
    x.wrapping_mul(31).wrapping_add(7)
}

/// `n` calls of `tiny` under one root span: the per-call cost of a *nested* span.
#[inline(never)]
pub fn nested_batch(n: u64) -> u64 {
    let mut acc = 0;
    for i in 0..n {
        acc ^= tiny(i);
    }
    acc
}

/// A keyed lookup behind a 64-byte checksum, about the weight of a storage-engine
/// point read: a few hundred nanoseconds of real work per call.
pub struct Store {
    map: HashMap<u64, u64>,
    block: [u8; 64],
}

impl Store {
    pub fn new() -> Self {
        let mut block = [0u8; 64];
        for (i, b) in block.iter_mut().enumerate() {
            *b = (i * 7) as u8;
        }
        Store { map: (0..1024).map(|k| (k, k * 3)).collect(), block }
    }

    #[inline(never)]
    pub fn get(&self, key: u64) -> Option<u64> {
        let h = self.checksum(key);
        self.map.get(&((key ^ h) % 1024)).copied()
    }

    #[inline(never)]
    fn checksum(&self, key: u64) -> u64 {
        let mut h = key;
        for b in self.block {
            h = h.wrapping_mul(0x0100_0000_01b3) ^ u64::from(b);
        }
        h
    }
}

impl Default for Store {
    fn default() -> Self {
        Self::new()
    }
}
