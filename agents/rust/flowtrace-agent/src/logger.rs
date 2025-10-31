use std::fs::OpenOptions;
use std::io::Write;
use crate::{Config, TraceEvent};

/// Thread-safe JSONL logger
pub struct Logger {
    config: Config,
    file: Option<std::fs::File>,
}

impl Logger {
    /// Create a new logger
    pub fn new(config: Config) -> Result<Self, std::io::Error> {
        let file = if !config.log_file.is_empty() {
            Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&config.log_file)?,
            )
        } else {
            None
        };

        Ok(Self { config, file })
    }

    /// Log a trace event
    pub fn log(&mut self, event: TraceEvent) {
        if let Ok(json) = serde_json::to_string(&event) {
            let line = format!("{}\n", json);

            // Write to file
            if let Some(file) = &mut self.file {
                let _ = file.write_all(line.as_bytes());
                let _ = file.flush();
            }

            // Write to stdout
            if self.config.stdout {
                print!("{}", line);
            }
        }
    }
}

impl Drop for Logger {
    fn drop(&mut self) {
        if let Some(file) = &mut self.file {
            let _ = file.flush();
        }
    }
}
