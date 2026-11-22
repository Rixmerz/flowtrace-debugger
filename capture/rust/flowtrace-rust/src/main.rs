//! `flowtrace-rust`: traces a Cargo workspace without editing its source.
//!
//! Driver mode (what a person runs, normally through `flowtrace run`):
//!
//! ```text
//! flowtrace-rust [--dir DIR] [--capture-dir DIR] [--package-prefix P] cargo run|build|test [args]
//! ```
//!
//! Wrapper mode (what cargo runs, selected by `FLOWTRACE_RUSTC_WRAPPER=1`) is in
//! [`wrap`]: the same binary is both halves, so there is one thing to build.

mod driver;
mod rewrite;
mod wrap;

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if std::env::var(wrap::ENV_MODE).as_deref() == Ok("1") {
        return wrap::run(args);
    }
    driver::run(&args)
}
