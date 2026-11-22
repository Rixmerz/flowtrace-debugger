//! Environment contract, shared with the other capture layers.
//!
//! Read once, on first use. A bad value falls back to the default rather than
//! erroring: a typo in an env var must not take down the traced application.

use crate::ids::{SpanId, TraceId};
use crate::traceparent;
use std::sync::OnceLock;

const DEFAULT_MAX_ARG_LENGTH: usize = 512;
const DEFAULT_MAX_EVENTS: u64 = 100_000;

const DEFAULT_REDACT_KEYS: &[&str] = &[
    "password", "secret", "token", "authorization", "api_key", "url", "dsn",
    "connection_string", "email",
];

#[doc(hidden)]
pub struct Config {
    /// `FLOWTRACE_OUTPUT`; `None` means `.flowtrace/<timestamp>.jsonl`.
    pub output: Option<String>,
    /// `FLOWTRACE_MAX_ARG_LENGTH`; `0` disables truncation.
    pub max_arg_length: usize,
    /// `FLOWTRACE_CAPTURE_ARGS=0` records spans only, with no argument or result values.
    pub capture_values: bool,
    /// `FLOWTRACE_MAX_EVENTS`; `0` disables the cap.
    pub max_events: u64,
    /// `FLOWTRACE_SYNC=1` writes every event straight to the file.
    pub sync: bool,
    /// Lowercased substrings; an argument whose name contains one is redacted.
    pub redact: Vec<String>,
    /// `FLOWTRACE_TRACEPARENT`: the caller's span, if this process was launched under one.
    pub seed: Option<(TraceId, SpanId)>,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn load() -> Config {
    let max_arg_length = match var("FLOWTRACE_MAX_ARG_LENGTH").and_then(|v| v.trim().parse::<i64>().ok()) {
        Some(n) if n < 0 => 0,
        Some(n) => n as usize,
        None => DEFAULT_MAX_ARG_LENGTH,
    };
    let max_events = match var("FLOWTRACE_MAX_EVENTS").and_then(|v| v.trim().parse::<i64>().ok()) {
        Some(n) if n <= 0 => 0,
        Some(n) => n as u64,
        None => DEFAULT_MAX_EVENTS,
    };
    // Additive, never a replacement: same contract as the other layers.
    let mut redact: Vec<String> = DEFAULT_REDACT_KEYS.iter().map(|s| (*s).to_owned()).collect();
    if let Some(extra) = var("FLOWTRACE_REDACT_KEYS") {
        for k in extra.split(',').map(|k| k.trim().to_lowercase()) {
            if !k.is_empty() && !redact.contains(&k) {
                redact.push(k);
            }
        }
    }
    Config {
        output: var("FLOWTRACE_OUTPUT"),
        max_arg_length,
        capture_values: var("FLOWTRACE_CAPTURE_ARGS").as_deref() != Some("0"),
        max_events,
        sync: var("FLOWTRACE_SYNC").as_deref() == Some("1"),
        redact,
        seed: var(traceparent::ENV_TRACEPARENT).and_then(|h| traceparent::parse(&h)),
    }
}

pub fn get() -> &'static Config {
    static CONFIG: OnceLock<Config> = OnceLock::new();
    CONFIG.get_or_init(load)
}

impl Config {
    /// Runs once per argument per call, so the ASCII case (every identifier a
    /// Rust function can have) compares in place without allocating.
    pub fn is_redacted(&self, name: &str) -> bool {
        if name.is_ascii() {
            let name = name.as_bytes();
            return self.redact.iter().any(|k| {
                let k = k.as_bytes();
                k.is_ascii() && name.windows(k.len()).any(|w| w.eq_ignore_ascii_case(k))
            });
        }
        let lowered = name.to_lowercase();
        self.redact.iter().any(|k| lowered.contains(k.as_str()))
    }
}
