//! JSON text helpers. The events are written by hand: the shape is fixed, and a
//! serialisation dependency would be a dependency of every traced program.

use std::fmt::{self, Write};

/// Appends `s` as a JSON string literal, quotes included.
pub(crate) fn push_str_lit(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn str_lit(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    push_str_lit(&mut out, s);
    out
}

/// A `fmt::Write` that stops accepting text after `limit` bytes, so rendering a
/// huge `Debug` value costs the limit, not the value's size.
pub(crate) struct Bounded {
    pub buf: String,
    limit: usize,
    pub overflowed: bool,
}

impl Bounded {
    pub fn new(limit: usize) -> Self {
        Self { buf: String::new(), limit, overflowed: false }
    }
}

impl Write for Bounded {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        if self.limit == 0 {
            self.buf.push_str(s);
            return Ok(());
        }
        let room = self.limit.saturating_sub(self.buf.len());
        if s.len() <= room {
            self.buf.push_str(s);
            return Ok(());
        }
        let mut cut = room;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        self.buf.push_str(&s[..cut]);
        self.overflowed = true;
        // Returning an error makes the value's own formatter stop early.
        Err(fmt::Error)
    }
}

/// Applies TRUNCATION_SYSTEM.md to the JSON value `out[start..]`: past `max`
/// bytes it becomes the string `<truncated:{first max bytes}...>`. `max == 0`
/// disables the rule.
pub fn truncate_from(out: &mut String, start: usize, max: usize) {
    if max == 0 || out.len() - start <= max {
        return;
    }
    let mut cut = start + max;
    while !out.is_char_boundary(cut) {
        cut -= 1;
    }
    let marker = str_lit(&format!("<truncated:{}...>", &out[start..cut]));
    out.truncate(start);
    out.push_str(&marker);
}

/// [`truncate_from`] for a value held on its own.
pub fn truncate(mut json: String, max: usize) -> String {
    truncate_from(&mut json, 0, max);
    json
}

/// A `fmt::Write` that appends what it is given to `out` as the inside of a JSON
/// string, escaping as it goes, and refuses further text once the JSON passes
/// `limit` bytes (so rendering a huge `Debug` value costs the limit, not the
/// value). `limit == 0` is unbounded.
pub(crate) struct Escaped<'a> {
    pub out: &'a mut String,
    start: usize,
    limit: usize,
    pub overflowed: bool,
}

impl<'a> Escaped<'a> {
    /// `out[start..]` is where the value begins, opening quote included.
    pub fn new(out: &'a mut String, start: usize, limit: usize) -> Self {
        Self { out, start, limit, overflowed: false }
    }
}

impl Write for Escaped<'_> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let mut run = 0;
        for (i, b) in s.bytes().enumerate() {
            let escape = match b {
                b'"' => Some("\\\""),
                b'\\' => Some("\\\\"),
                b'\n' => Some("\\n"),
                b'\r' => Some("\\r"),
                b'\t' => Some("\\t"),
                0..=0x1f => None,
                _ => continue,
            };
            self.out.push_str(&s[run..i]);
            match escape {
                Some(e) => self.out.push_str(e),
                None => {
                    let _ = write!(self.out, "\\u{:04x}", b);
                }
            }
            run = i + 1;
        }
        self.out.push_str(&s[run..]);
        if self.limit != 0 && self.out.len() - self.start > self.limit {
            self.overflowed = true;
            // Returning an error makes the value's own formatter stop early.
            return Err(fmt::Error);
        }
        Ok(())
    }
}

/// The inside of a JSON string literal, back to plain text. Only undoes what
/// [`push_str_lit`] and [`Escaped`] write.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let hex: String = it.by_ref().take(4).collect();
                out.push(u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32).unwrap_or('\u{fffd}'));
            }
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

/// End of the Debug value starting at `from`: the first `,` or closing bracket
/// at depth 0, with string literals and nested brackets stepped over.
fn value_end(t: &str, from: usize) -> usize {
    let b = t.as_bytes();
    let (mut i, mut depth) = (from, 0usize);
    while i < b.len() {
        match b[i] {
            b'"' => i = string_end(b, i) - 1,
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return i,
            b')' | b']' | b'}' => depth -= 1,
            b',' if depth == 0 => return i,
            _ => {}
        }
        i += 1;
    }
    b.len()
}

/// Index just past the string literal whose opening quote is at `open`.
fn string_end(b: &[u8], open: usize) -> usize {
    let mut i = open + 1;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 1,
            b'"' => return i + 1,
            _ => {}
        }
        i += 1;
    }
    b.len()
}

/// Redacts by name inside the `Debug` text of a value, at any depth: a struct
/// field or map key (`password: "x"`, `{"token": 1}`) for which `is_redacted`
/// holds has its value replaced with `"<redacted>"`, the same rule the layers
/// that see a structure apply to nested keys. `Debug` output is all this layer
/// has, so this reads it as text; it is best-effort for a hand-written `Debug`
/// that does not print `name: value`. `None` when nothing matched.
pub fn redact_debug(t: &str, is_redacted: &dyn Fn(&str) -> bool) -> Option<String> {
    let b = t.as_bytes();
    let mut out = String::new();
    let (mut copied, mut i, mut changed) = (0, 0, false);
    while i < b.len() {
        let (key, after) = if b[i] == b'"' {
            let end = string_end(b, i);
            (&t[(i + 1).min(end)..end.saturating_sub(1).max(i + 1)], end)
        } else if b[i].is_ascii_alphanumeric() || b[i] == b'_' {
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                j += 1;
            }
            (&t[i..j], j)
        } else {
            i += 1;
            continue;
        };
        i = after;
        // `name:` but not the path separator in `Type::Variant`.
        if b.get(after) != Some(&b':') || b.get(after + 1) == Some(&b':') || !is_redacted(key) {
            continue;
        }
        let mut v = after + 1;
        while b.get(v) == Some(&b' ') {
            v += 1;
        }
        let end = value_end(t, v);
        out.push_str(&t[copied..v]);
        out.push_str("\"<redacted>\"");
        copied = end;
        i = end;
        changed = true;
    }
    if !changed {
        return None;
    }
    out.push_str(&t[copied..]);
    Some(out)
}

/// [`redact_debug`] for a value already written, escaped, as `out[start..]`:
/// a closing quote is present unless rendering was cut off at the limit.
pub(crate) fn redact_rendered(out: &mut String, start: usize, closed: bool, is_redacted: &dyn Fn(&str) -> bool) {
    let end = if closed { out.len() - 1 } else { out.len() };
    let plain = unescape(&out[start + 1..end]);
    if let Some(red) = redact_debug(&plain, is_redacted) {
        out.truncate(start + 1);
        let mut w = Escaped::new(out, start, 0);
        let _ = w.write_str(&red);
        if closed {
            out.push('"');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_what_json_requires() {
        assert_eq!(str_lit("a\"b\\c\nd\u{1}"), r#""a\"b\\c\nd\u0001""#);
        assert_eq!(str_lit("héllo ✓"), "\"héllo ✓\"");
    }

    #[test]
    fn bounded_stops_early_on_a_char_boundary() {
        let mut b = Bounded::new(4);
        assert!(b.write_str("ab✓✓").is_err());
        assert!(b.overflowed);
        assert_eq!(b.buf, "ab");
    }

    #[test]
    fn escaped_writer_escapes_and_stops_past_the_limit() {
        let mut out = String::from("\"");
        let mut w = Escaped::new(&mut out, 0, 0);
        w.write_str("a\"b\nc\u{1}é").unwrap();
        assert_eq!(out, "\"a\\\"b\\nc\\u0001é");

        let mut out = String::from("\"");
        let mut w = Escaped::new(&mut out, 0, 4);
        assert!(w.write_str("abcdefgh").is_err());
        assert!(w.overflowed);
        truncate_from(&mut out, 0, 4);
        assert_eq!(out, "\"<truncated:\\\"abc...>\"");
    }

    #[test]
    fn debug_text_is_redacted_by_nested_name() {
        let red = |k: &str| k.to_lowercase().contains("password") || k.to_lowercase().contains("token");
        let t = r#"User { name: "ann", password: "p,w)", inner: Cfg { api_token: Some("t"), n: 1 }, m: {"Token": [1, 2], "ok": 3} }"#;
        assert_eq!(
            redact_debug(t, &red).unwrap(),
            r#"User { name: "ann", password: "<redacted>", inner: Cfg { api_token: "<redacted>", n: 1 }, m: {"Token": "<redacted>", "ok": 3} }"#
        );
        assert_eq!(redact_debug("Type::password(1)", &red), None);
        assert_eq!(redact_debug("a: \"password\"", &red), None);
    }

    #[test]
    fn rendered_text_is_redacted_through_its_escaping() {
        let red = |k: &str| k == "password";
        let mut out = String::from("\"S { password: \\\"x\\ny\\\", n: 1 }\"");
        redact_rendered(&mut out, 0, true, &red);
        assert_eq!(out, "\"S { password: \\\"<redacted>\\\", n: 1 }\"");
    }

    #[test]
    fn truncation_matches_the_other_layers() {
        assert_eq!(truncate("\"abc\"".into(), 0), "\"abc\"");
        assert_eq!(truncate("\"abc\"".into(), 5), "\"abc\"");
        assert_eq!(truncate("\"abcdef\"".into(), 4), "\"<truncated:\\\"abc...>\"");
    }
}
