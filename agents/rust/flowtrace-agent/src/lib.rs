//! FlowTrace Agent for Rust
//!
//! Provides function tracing capabilities for Rust applications.
//!
//! # Example
//!
//! ```rust
//! use flowtrace_agent::{trace, Config, start_tracing, stop_tracing};
//!
//! fn main() {
//!     let config = Config::default();
//!     start_tracing(config).unwrap();
//!
//!     my_function(42);
//!
//!     stop_tracing();
//! }
//!
//! #[trace]
//! fn my_function(value: i32) -> i32 {
//!     value * 2
//! }
//! ```

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use chrono::Utc;

mod config;
mod logger;
pub mod span;
pub mod middleware;

pub use config::Config;
pub use logger::Logger;
pub use span::{Span, start_span};

/// Trace event type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum EventType {
    Enter,
    Exit,
    Exception,
}

/// Trace event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEvent {
    #[serde(rename = "event")]
    pub event_type: EventType,
    pub timestamp: i64,
    #[serde(rename = "class")]
    pub module: String,
    #[serde(rename = "method")]
    pub function: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "durationMillis")]
    pub duration_millis: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "durationMicros")]
    pub duration_micros: Option<i64>,
    pub thread: String,
}

impl TraceEvent {
    /// Create a new ENTER event
    pub fn enter(module: &str, function: &str, args: Option<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_micros() as i64;

        Self {
            event_type: EventType::Enter,
            timestamp: now,
            module: module.to_string(),
            function: function.to_string(),
            args,
            result: None,
            exception: None,
            duration_millis: None,
            duration_micros: None,
            thread: format!("{:?}", std::thread::current().id()),
        }
    }

    /// Create a new EXIT event
    pub fn exit(module: &str, function: &str, result: Option<String>, duration_micros: Option<i64>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_micros() as i64;

        let duration_millis = duration_micros.map(|d| d / 1000);

        Self {
            event_type: EventType::Exit,
            timestamp: now,
            module: module.to_string(),
            function: function.to_string(),
            args: None,
            result,
            exception: None,
            duration_millis,
            duration_micros,
            thread: format!("{:?}", std::thread::current().id()),
        }
    }

    /// Create a new EXCEPTION event
    pub fn exception(module: &str, function: &str, error: &str, duration_micros: Option<i64>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_micros() as i64;

        let duration_millis = duration_micros.map(|d| d / 1000);

        Self {
            event_type: EventType::Exception,
            timestamp: now,
            module: module.to_string(),
            function: function.to_string(),
            args: None,
            result: None,
            exception: Some(error.to_string()),
            duration_millis,
            duration_micros,
            thread: format!("{:?}", std::thread::current().id()),
        }
    }
}

/// Global tracer instance
static mut GLOBAL_TRACER: Option<Arc<Mutex<Logger>>> = None;

/// Initialize global tracing
pub fn start_tracing(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        if GLOBAL_TRACER.is_some() {
            return Err("Tracer already initialized".into());
        }
        let logger = Logger::new(config)?;
        GLOBAL_TRACER = Some(Arc::new(Mutex::new(logger)));
    }
    Ok(())
}

/// Stop global tracing
pub fn stop_tracing() {
    unsafe {
        GLOBAL_TRACER = None;
    }
}

/// Log a trace event
pub fn log_event(event: TraceEvent) {
    unsafe {
        if let Some(tracer) = &GLOBAL_TRACER {
            if let Ok(mut logger) = tracer.lock() {
                logger.log(event);
            }
        }
    }
}

/// Macro for manual function tracing
#[macro_export]
macro_rules! trace_function {
    ($module:expr, $function:expr, $body:expr) => {{
        let start = std::time::Instant::now();
        $crate::log_event($crate::TraceEvent::enter($module, $function, None));

        let result = (|| $body)();

        let duration = start.elapsed().as_secs_f64() * 1000.0;
        $crate::log_event($crate::TraceEvent::exit(
            $module,
            $function,
            None,
            Some(duration),
        ));

        result
    }};
}

/// Procedural macro attribute for automatic tracing (placeholder)
///
/// Note: This would require a separate proc-macro crate
/// For now, use manual instrumentation with trace_function! macro
pub use flowtrace_agent_attribute::trace;

// Placeholder module for proc macro
#[doc(hidden)]
pub mod flowtrace_agent_attribute {
    pub use flowtrace_derive::trace;
}
