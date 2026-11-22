//! Event serialisation: the one place that knows the FlowTrace v2 line shape
//! (`schema/flowtrace-v2.json`). The span guard and the `tracing` layer both
//! write through here, so the two entry points cannot drift apart.
//!
//! Numbers and ids are written by hand rather than through `format!`: this runs
//! twice per traced call, and the formatting machinery is a large part of what a
//! call costs. The parts of a line that never change for a function (`lang`,
//! `module`, `class`, `method`, `visibility`) are escaped once, into a
//! [`fragment`], and copied.

use crate::ids::{SpanId, TraceId};
use crate::json::push_str_lit;
use crate::sink;
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// What identifies a span in both of its events.
#[doc(hidden)]
pub struct Identity<'a> {
    pub trace: TraceId,
    pub span: SpanId,
    pub parent: Option<SpanId>,
    /// The thread name as a JSON string literal, quotes included.
    pub thread: &'a str,
    /// From [`fragment`].
    pub fragment: &'a str,
    /// A rendered JSON object, e.g. `{"a":1}`.
    pub args: &'a str,
    pub depth: u32,
    /// When the event happens. One clock read serves the `ts` and the duration.
    pub at: Instant,
}

/// The error of a failed call: `type`, `msg`, `stack`.
#[doc(hidden)]
pub struct ErrorInfo<'a> {
    pub kind: &'a str,
    pub msg: &'a str,
    pub stack: &'a [String],
}

/// `"lang":"rust","module":..,"class":..,"method":..,"visibility":..`, escaped.
#[doc(hidden)]
pub fn fragment(module: &str, class: &str, method: &str, visibility: &str) -> String {
    let mut out = String::with_capacity(module.len() + class.len() + method.len() + visibility.len() + 80);
    out.push_str("\"lang\":\"rust\",\"module\":");
    push_str_lit(&mut out, module);
    out.push_str(",\"class\":");
    push_str_lit(&mut out, class);
    out.push_str(",\"method\":");
    push_str_lit(&mut out, method);
    out.push_str(",\"visibility\":");
    push_str_lit(&mut out, visibility);
    out
}

thread_local! {
    static LINE: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Appends ASCII `bytes`.
fn push_ascii(out: &mut String, bytes: &[u8]) {
    debug_assert!(bytes.is_ascii());
    // SAFETY: every caller passes digits, hex digits or `.`, all ASCII, which is
    // valid UTF-8; skipping the re-validation is the point (this runs per event).
    out.push_str(unsafe { std::str::from_utf8_unchecked(bytes) });
}

fn push_u64(out: &mut String, mut n: u64) {
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    push_ascii(out, &buf[i..]);
}

/// Sixteen lowercase hex digits of `n`, two at a time.
fn hex64(buf: &mut [u8], n: u64) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for (i, byte) in n.to_be_bytes().into_iter().enumerate() {
        buf[2 * i] = HEX[usize::from(byte >> 4)];
        buf[2 * i + 1] = HEX[usize::from(byte & 0xf)];
    }
}

fn push_hex64(out: &mut String, n: u64) {
    let mut buf = [0u8; 16];
    hex64(&mut buf, n);
    push_ascii(out, &buf);
}

fn push_hex128(out: &mut String, n: u128) {
    let mut buf = [0u8; 32];
    hex64(&mut buf[..16], (n >> 64) as u64);
    hex64(&mut buf[16..], n as u64);
    push_ascii(out, &buf);
}

/// Wall-clock time of `at`: the epoch time read once, plus how far the monotonic
/// clock has moved since. Reading `SystemTime` per event would double the clock
/// reads of a call, which is a measurable part of it.
fn wall(at: Instant) -> Duration {
    static ANCHOR: OnceLock<(Instant, Duration)> = OnceLock::new();
    let (base, epoch) = ANCHOR.get_or_init(|| (Instant::now(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()));
    *epoch + at.saturating_duration_since(*base)
}

fn head(out: &mut String, id: &Identity<'_>, event: &str) {
    let now = wall(id.at);
    out.push_str("{\"ts\":");
    push_u64(out, now.as_secs());
    let mut micros = now.subsec_micros();
    let mut frac = *b".000000";
    for slot in frac[1..].iter_mut().rev() {
        *slot = b'0' + (micros % 10) as u8;
        micros /= 10;
    }
    push_ascii(out, &frac);
    out.push_str(",\"trace_id\":\"");
    push_hex128(out, id.trace);
    out.push_str("\",\"span_id\":\"");
    push_hex64(out, id.span);
    out.push_str("\",\"parent_id\":");
    match id.parent {
        Some(p) => {
            out.push('"');
            push_hex64(out, p);
            out.push('"');
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"event\":\"");
    out.push_str(event);
    out.push_str("\",\"thread\":");
    out.push_str(id.thread);
    out.push(',');
    out.push_str(id.fragment);
    out.push_str(",\"args\":");
    out.push_str(id.args);
}

/// Writes an `enter` event.
#[doc(hidden)]
pub fn write_enter(id: &Identity<'_>) {
    LINE.with(|l| {
        let mut l = l.borrow_mut();
        l.clear();
        head(&mut l, id, "enter");
        l.push_str(",\"depth\":");
        push_u64(&mut l, u64::from(id.depth));
        l.push('}');
        sink::write_line(&l, false);
    });
}

/// Writes an `exit` event. `result` is the *body* of the result object
/// (`"r0":5`, or empty): the schema requires `result`, so it is `{}` when empty.
#[doc(hidden)]
pub fn write_exit(id: &Identity<'_>, result: &str, error: Option<ErrorInfo<'_>>, duration_ns: u64) {
    LINE.with(|l| {
        let mut l = l.borrow_mut();
        l.clear();
        head(&mut l, id, "exit");
        l.push_str(",\"result\":{");
        l.push_str(result);
        l.push('}');
        if let Some(e) = error {
            l.push_str(",\"error\":{\"type\":");
            push_str_lit(&mut l, e.kind);
            l.push_str(",\"msg\":");
            push_str_lit(&mut l, e.msg);
            l.push_str(",\"stack\":[");
            for (i, frame) in e.stack.iter().enumerate() {
                if i > 0 {
                    l.push(',');
                }
                push_str_lit(&mut l, frame);
            }
            l.push_str("]}");
        }
        l.push_str(",\"duration_ns\":");
        push_u64(&mut l, duration_ns);
        l.push_str(",\"depth\":");
        push_u64(&mut l, u64::from(id.depth));
        l.push('}');
        sink::write_line(&l, id.depth == 0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_and_hex_are_fixed_width_and_exact() {
        let mut s = String::new();
        push_u64(&mut s, 0);
        s.push(' ');
        push_u64(&mut s, u64::MAX);
        assert_eq!(s, "0 18446744073709551615");
        let mut s = String::new();
        push_hex64(&mut s, 0xabc);
        push_hex128(&mut s, u128::MAX - 0xfff);
        assert_eq!(s, format!("{:016x}{:032x}", 0xabc, u128::MAX - 0xfff));
    }
}
