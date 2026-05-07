use std::env;

/// Configuration for FlowTrace agent
#[derive(Debug, Clone)]
pub struct Config {
    pub package_prefix: String,
    pub log_file: String,
    pub stdout: bool,
    pub max_arg_length: usize,
}

impl Config {
    /// Create configuration from environment variables
    pub fn from_env() -> Self {
        Self {
            package_prefix: env::var("FLOWTRACE_PACKAGE_PREFIX").unwrap_or_default(),
            log_file: env::var("FLOWTRACE_LOGFILE").unwrap_or_else(|_| "flowtrace.jsonl".to_string()),
            stdout: env::var("FLOWTRACE_STDOUT").map(|v| v == "true").unwrap_or(false),
            max_arg_length: env::var("FLOWTRACE_MAX_ARG_LENGTH")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            package_prefix: String::new(),
            log_file: "flowtrace.jsonl".to_string(),
            stdout: false,
            max_arg_length: 1000,
        }
    }
}
