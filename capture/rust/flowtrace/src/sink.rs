//! The JSONL writer: one process-wide, thread-safe sink.
//!
//! Unlike the Go layer, which hands every event straight to the OS, this one
//! buffers. A storage hot loop makes millions of calls, and one `write(2)` per
//! event would cost more than the work being measured. The trade is that a
//! process killed by a signal can lose the tail of its trace, so the buffer is
//! flushed:
//!
//!  * when it passes 64 KiB;
//!  * when a root span closes, if 50 ms have passed since the last flush;
//!  * from the panic hook, and from `atexit` (normal return from `main`,
//!    `std::process::exit`);
//!  * on every event, with `FLOWTRACE_SYNC=1`;
//!  * on demand, with [`crate::flush`].
//!
//! A process that is `SIGKILL`ed, or that aborts without a panic, loses up to
//! one buffer. Use `FLOWTRACE_SYNC=1` when that matters more than speed.
//!
//! Writes are whole lines, and the file is opened in append mode, so several
//! processes (every test binary of a `cargo test` run) can share one file.

use crate::config;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, Once};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const BUFFER_LIMIT: usize = 64 * 1024;
const IDLE_FLUSH: Duration = Duration::from_millis(50);

struct Inner {
    file: Option<File>,
    buf: Vec<u8>,
    /// Opening failed once; do not retry (and warn) on every event.
    broken: bool,
    last_flush: Option<Instant>,
}

static SINK: Mutex<Inner> = Mutex::new(Inner { file: None, buf: Vec::new(), broken: false, last_flush: None });
/// Events written so far (enters and exits), for the cap.
static COUNT: AtomicU64 = AtomicU64::new(0);
static CAP_WARNED: AtomicBool = AtomicBool::new(false);
/// Set once the cap is hit, never cleared: lets every later call return after a
/// single relaxed load, which is what a hot loop past the cap pays.
static CAPPED: AtomicBool = AtomicBool::new(false);

fn lock() -> MutexGuard<'static, Inner> {
    // A panic while holding the lock must not silence the trace of the panic.
    SINK.lock().unwrap_or_else(|p| p.into_inner())
}

fn default_path() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    format!(".flowtrace/{secs}.jsonl")
}

fn open() -> std::io::Result<File> {
    let path = config::get().output.clone().unwrap_or_else(default_path);
    if let Some(dir) = std::path::Path::new(&path).parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    OpenOptions::new().create(true).append(true).open(path)
}

impl Inner {
    fn flush(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        if self.file.is_none() && !self.broken {
            match open() {
                Ok(f) => self.file = Some(f),
                Err(e) => {
                    self.broken = true;
                    eprintln!("[flowtrace] WARNING: cannot open the trace file, events are dropped — {e}");
                }
            }
        }
        if let Some(f) = self.file.as_mut() {
            if let Err(e) = f.write_all(&self.buf) {
                self.broken = true;
                self.file = None;
                eprintln!("[flowtrace] WARNING: failed writing events — {e}");
            }
        }
        self.buf.clear();
        self.last_flush = Some(Instant::now());
    }
}

/// Once per process: the `atexit` flush and the panic hook.
pub fn ensure_init() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        extern "C" {
            fn atexit(cb: extern "C" fn()) -> i32;
        }
        extern "C" fn at_exit() {
            flush();
        }
        // SAFETY: `atexit` is C standard library; the callback is a plain
        // `extern "C" fn` that takes no arguments and touches only statics.
        unsafe {
            atexit(at_exit);
        }
        crate::panic::install_hook();
    });
}

/// Reserves room for a new span. `false` once the cap is reached: the cap only
/// ever stops new spans from opening. A span whose `enter` was written always
/// gets its `exit` (see [`write_line`]), because an `enter` with no `exit` is
/// what every consumer reads as "this call never returned".
pub fn admit() -> bool {
    if CAPPED.load(Ordering::Relaxed) {
        return false;
    }
    let limit = config::get().max_events;
    if limit == 0 || COUNT.load(Ordering::Relaxed) < limit {
        return true;
    }
    CAPPED.store(true, Ordering::Relaxed);
    if !CAP_WARNED.swap(true, Ordering::Relaxed) {
        eprintln!(
            "[flowtrace] WARNING: reached the {limit}-event cap (FLOWTRACE_MAX_EVENTS) — no further calls are entered into the trace for the rest of this process. Calls already open still get their exit recorded, so 'enter' without 'exit' keeps meaning: this call did not return. Raise the cap, or set it to 0, for the full trace."
        );
    }
    false
}

/// Appends one finished line (no trailing newline needed). `root_exit` marks the
/// close of a root span, the cheapest moment to flush an idle buffer.
pub(crate) fn write_line(line: &str, root_exit: bool) {
    COUNT.fetch_add(1, Ordering::Relaxed);
    let sync = config::get().sync;
    let mut s = lock();
    s.buf.extend_from_slice(line.as_bytes());
    s.buf.push(b'\n');
    if sync || s.buf.len() >= BUFFER_LIMIT || (root_exit && s.last_flush.map_or(true, |t| t.elapsed() >= IDLE_FLUSH)) {
        s.flush();
    }
}

/// Writes any buffered events to the trace file.
pub fn flush() {
    lock().flush();
}

/// Flushes, then reads the trace file at `path` and returns its complete lines,
/// for a process that reads its own trace while it is still writing it (tests).
///
/// A plain read of a file that is being appended to can end mid-line: the
/// kernel publishes a `write(2)` to readers page by page, so a read that
/// overlaps one sees a prefix of it. The read happens under the sink lock, so
/// no write of this process is in flight, and anything after the last newline
/// is dropped, which covers another process appending to the same file.
///
/// # Errors
/// Whatever reading `path` returns, e.g. `NotFound` before the first flush.
pub fn read_complete_lines(path: &std::path::Path) -> std::io::Result<String> {
    let bytes = {
        let mut s = lock();
        s.flush();
        std::fs::read(path)?
    };
    Ok(complete_lines(bytes))
}

/// The text up to and including the last newline.
fn complete_lines(mut bytes: Vec<u8>) -> String {
    let end = bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    bytes.truncate(end);
    // Every line the sink writes is UTF-8; lossy only guards a foreign writer.
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

#[cfg(test)]
mod tests {
    use super::complete_lines;

    /// The shape of the flake: a whole line, then one cut inside a string by a
    /// read that overlapped an append. Only the whole line may come back.
    #[test]
    fn a_line_cut_mid_write_is_not_returned() {
        let whole = r#"{"event":"enter","method":"a"}"#;
        let torn = format!("{whole}\n{{\"event\":\"exit\",\"error\":{{\"type\":\"pan");
        let text = complete_lines(torn.into_bytes());
        assert_eq!(text, format!("{whole}\n"));
        for line in text.lines() {
            serde_json::from_str::<serde_json::Value>(line).expect("only whole lines are returned");
        }
    }

    /// A cut can also fall inside a multi-byte character; that must not turn the
    /// whole read into an error (or into nothing).
    #[test]
    fn a_cut_inside_a_multibyte_character_keeps_the_whole_lines() {
        let mut bytes = "{\"s\":\"ñ\"}\n{\"s\":\"ñ".as_bytes().to_vec();
        bytes.pop(); // half of the trailing `ñ`
        assert_eq!(complete_lines(bytes), "{\"s\":\"ñ\"}\n");
    }

    #[test]
    fn a_file_with_no_newline_yet_has_no_lines() {
        assert_eq!(complete_lines(b"{\"ts\":1".to_vec()), "");
    }
}
