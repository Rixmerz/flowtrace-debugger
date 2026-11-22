//! W3C Trace Context, so a Rust process can join a trace another process started.
//!
//! Spec: <https://www.w3.org/TR/trace-context/#traceparent-header>
//!
//! ```text
//! traceparent = version "-" trace-id "-" parent-id "-" trace-flags
//! ```
//!
//! Every field is *lowercase* hex. Uppercase is rejected rather than
//! normalised, exactly as in the Node, Python and Go layers: being lenient
//! would let us emit a `trace_id` that fails our own schema.

use crate::ids::{SpanId, TraceId};

/// The carrier every FlowTrace runtime reads on startup.
pub const ENV_TRACEPARENT: &str = "FLOWTRACE_TRACEPARENT";

fn lower_hex(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Parses a `traceparent` header into `(trace_id, parent_span_id)`.
///
/// Returns `None` for anything malformed: a bad header must never take the
/// traced program down, it just means this process starts its own trace.
pub fn parse(header: &str) -> Option<(TraceId, SpanId)> {
    let mut parts = header.trim().split('-');
    let (version, trace, span, flags) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let extra = parts.next();
    if !lower_hex(version, 2) || version == "ff" || !lower_hex(flags, 2) {
        return None;
    }
    // Version 00 has exactly four fields; later versions may append more.
    if version == "00" && extra.is_some() {
        return None;
    }
    if !lower_hex(trace, 32) || !lower_hex(span, 16) {
        return None;
    }
    let trace = u128::from_str_radix(trace, 16).ok()?;
    let span = u64::from_str_radix(span, 16).ok()?;
    if trace == 0 || span == 0 {
        return None;
    }
    Some((trace, span))
}

/// Renders a `traceparent` header (sampled flag set).
pub fn format(trace: TraceId, span: SpanId) -> String {
    format!("00-{trace:032x}-{span:016x}-01")
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    #[test]
    fn parses_the_spec_example() {
        let (t, s) = parse(GOOD).unwrap();
        assert_eq!(t, 0x0af7651916cd43dd8448eb211c80319c);
        assert_eq!(s, 0xb7ad6b7169203331);
    }

    #[test]
    fn round_trips() {
        let (t, s) = parse(GOOD).unwrap();
        assert_eq!(format(t, s), GOOD);
    }

    #[test]
    fn rejects_what_the_spec_rejects() {
        for bad in [
            "",
            "garbage",
            "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            "00-00000000000000000000000000000000-b7ad6b7169203331-01",
            "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01",
            "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331",
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
            "00-0af7651916cd43dd8448eb211c80319-b7ad6b7169203331-01",
        ] {
            assert_eq!(parse(bad), None, "{bad:?} must be rejected");
        }
    }

    #[test]
    fn later_versions_may_append_fields() {
        let h = "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-future";
        assert!(parse(h).is_some());
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert!(parse(&format!("  {GOOD}\n")).is_some());
    }
}
