//! Span API for manual tracing control

use std::time::Instant;
use std::collections::HashMap;
use crate::TraceEvent;

/// A tracing span for timing and tagging operations
pub struct Span {
    module: String,
    function: String,
    start_time: Instant,
    tags: HashMap<String, String>,
    error: Option<String>,
}

impl Span {
    /// Create a new span
    pub fn new(module: &str, function: &str) -> Self {
        // Log ENTER event
        crate::log_event(TraceEvent::enter(module, function, None));

        Self {
            module: module.to_string(),
            function: function.to_string(),
            start_time: Instant::now(),
            tags: HashMap::new(),
            error: None,
        }
    }

    /// Add a tag to the span
    pub fn set_tag(&mut self, key: impl Into<String>, value: impl ToString) -> &mut Self {
        self.tags.insert(key.into(), value.to_string());
        self
    }

    /// Mark the span as errored
    pub fn set_error(&mut self, error: impl ToString) -> &mut Self {
        self.error = Some(error.to_string());
        self
    }

    /// Get the duration of the span in microseconds
    pub fn duration_micros(&self) -> i64 {
        self.start_time.elapsed().as_micros() as i64
    }

    /// End the span and log EXIT or EXCEPTION event
    pub fn end(self) {
        let duration_micros = self.duration_micros();

        if let Some(error) = &self.error {
            // Log EXCEPTION event
            crate::log_event(TraceEvent::exception(
                &self.module,
                &self.function,
                error,
                Some(duration_micros),
            ));
        } else {
            // Log EXIT event with tags as result
            let result = if self.tags.is_empty() {
                None
            } else {
                Some(format!("{:?}", self.tags))
            };

            crate::log_event(TraceEvent::exit(
                &self.module,
                &self.function,
                result,
                Some(duration_micros),
            ));
        }
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        // If end() wasn't called explicitly, log EXIT automatically
        if !std::thread::panicking() {
            let duration = self.duration_micros();
            let result = if self.tags.is_empty() {
                None
            } else {
                Some(format!("{:?}", self.tags))
            };

            crate::log_event(TraceEvent::exit(
                &self.module,
                &self.function,
                result,
                Some(duration),
            ));
        }
    }
}

/// Start a new span
pub fn start_span(module: &str, function: &str) -> Span {
    Span::new(module, function)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_creation() {
        let span = Span::new("test_module", "test_function");
        assert_eq!(span.module, "test_module");
        assert_eq!(span.function, "test_function");
    }

    #[test]
    fn test_span_tags() {
        let mut span = Span::new("test", "func");
        span.set_tag("user_id", 123)
            .set_tag("action", "login");

        assert_eq!(span.tags.get("user_id").unwrap(), "123");
        assert_eq!(span.tags.get("action").unwrap(), "login");
    }

    #[test]
    fn test_span_error() {
        let mut span = Span::new("test", "func");
        span.set_error("Something went wrong");
        assert!(span.error.is_some());
    }
}
