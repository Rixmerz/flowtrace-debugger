//! FlowTrace capture runtime for Rust.
//!
//! You normally never name this crate: `flowtrace run -- cargo run` rewrites
//! the functions of your workspace at build time and links this in. What it
//! writes is FlowTrace v2 JSONL (`schema/flowtrace-v2.json`), read by the same
//! CLI, dashboard and MCP tools as the other languages.
//!
//! Environment (shared with the other capture layers):
//!
//! | variable | meaning |
//! |---|---|
//! | `FLOWTRACE_OUTPUT` | trace file; default `.flowtrace/<timestamp>.jsonl` |
//! | `FLOWTRACE_TRACEPARENT` | W3C header of the caller's span: join its trace |
//! | `FLOWTRACE_MAX_ARG_LENGTH` | truncate a value past this many bytes of JSON; `0` = never (512) |
//! | `FLOWTRACE_REDACT_KEYS` | extra argument-name substrings to redact |
//! | `FLOWTRACE_MAX_EVENTS` | stop opening spans after this many events; `0` = no cap (100000) |
//! | `FLOWTRACE_CAPTURE_ARGS=0` | record spans and errors only, no argument or result values |
//! | `FLOWTRACE_SYNC=1` | write every event immediately, surviving `SIGKILL` |
//!
//! Hand-wiring (for a program that is not built through `flowtrace run`) is
//! limited to [`flush`], [`current_traceparent`] and [`remote_context`].

mod config;
mod event;
mod ids;
mod json;
mod panic;
mod probe;
mod sink;
mod span;
mod traceparent;

pub use sink::flush;
pub use span::{current_traceparent, remote_context, RemoteGuard};

/// Plumbing for the code `flowtrace run` splices in, and for `flowtrace-tracing`.
/// Not a stable API.
#[doc(hidden)]
pub mod __rt {
    pub use crate::config::get as config;
    pub use crate::event::{fragment, write_enter, write_exit, ErrorInfo, Identity};
    pub use crate::ids::{new_span_id, new_trace_id, SpanId, TraceId};
    pub use crate::json::{redact_debug, str_lit, truncate};
    pub use crate::sink::{admit, ensure_init, read_complete_lines};
    pub use crate::panic::{current as panic_info, PanicInfo};
    pub use crate::span::{enter, thread_name, ArgsBuf, Meta, SpanGuard};
    pub use crate::traceparent::{format as format_traceparent, parse as parse_traceparent};

    /// Runs a spliced function body. Taking an `FnOnce` makes the closure one,
    /// which lets a body return a reborrow of a captured `&mut` (see the rewriter).
    #[inline(always)]
    pub fn call<R>(body: impl FnOnce() -> R) -> R {
        body()
    }
    pub mod probe {
        pub use crate::probe::*;
    }
}

#[cfg(test)]
mod tests;
