//! The other entry point: a program that already uses `tracing` adds the
//! FlowTrace layer to its own subscriber. No driver, no rewriting: this is built
//! and run with plain `cargo run`.

use flowtrace_tracing::FlowtraceLayer;
use tracing::instrument;
use tracing_subscriber::prelude::*;

#[derive(Debug)]
struct PayError(String);

impl std::fmt::Display for PayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "payment refused: {}", self.0)
    }
}

#[instrument]
fn process(order_id: u32, customer: &str, api_key: &str) -> u32 {
    let paid = charge(order_id, 12.5).unwrap_or(0);
    let _ = charge(order_id, -1.0);
    paid + audit(order_id)
}

#[instrument(err, ret)]
fn charge(order_id: u32, amount: f64) -> Result<u32, PayError> {
    if amount < 0.0 {
        return Err(PayError(format!("order {order_id}")));
    }
    Ok(order_id + 1)
}

#[instrument(skip_all)]
fn audit(order_id: u32) -> u32 {
    order_id
}

#[instrument]
fn explode(n: u8) {
    panic!("boom {n}");
}

fn main() {
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(FlowtraceLayer::new()))
        .expect("first subscriber");
    process(41, "ada", "s3cr3t");
    let _ = std::panic::catch_unwind(|| explode(7));
}
