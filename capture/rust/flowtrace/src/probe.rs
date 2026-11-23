//! What to record about a value the program owns, without being able to name its type.
//!
//! The instrumented code is spliced into functions that know their argument and
//! return types but a rewriter cannot see which traits those types implement.
//! Autoref specialisation picks the best rendering the *compiler* can prove:
//! method resolution tries the receiver with the most `&`s first, so the most
//! specific impl sits on the deepest reference and the fallback on the bare
//! probe. Every tier shares one method name; exactly one tier's bounds hold
//! at the most specific level, and the compiler selects it.
//!
//! Arguments, best first:  JSON-native (numbers, bool, strings) → `Debug` → `<type name>`.
//!
//! Results add `Result<T, E>`, ranked by what is known of each side:
//! `T` native / `Debug` / opaque, then `E` `Display` / `Debug` / opaque. An
//! `Err` becomes the exit's `error`, which is how a failed Rust call surfaces
//! for `trace_find_error`. Outside a generic function the types are concrete
//! and the best tier is always found; inside one, only the declared bounds count.

use crate::config;
use crate::json::{push_str_lit, redact_rendered, str_lit, truncate_from, Bounded, Escaped};
use std::any::type_name;
use std::fmt::{Debug, Display, Write};

/// The probe: a copyable borrow of the value.
#[doc(hidden)]
pub struct __FtP<'a, T: ?Sized>(pub &'a T);
impl<T: ?Sized> Clone for __FtP<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: ?Sized> Copy for __FtP<'_, T> {}

/// Types with an exact JSON form.
#[doc(hidden)]
pub trait FtNative {
    fn json(&self, out: &mut String);
}

macro_rules! native_int {
    ($($t:ty)*) => {$(
        impl FtNative for $t {
            fn json(&self, out: &mut String) { let _ = write!(out, "{}", self); }
        }
    )*};
}
native_int!(i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize);

macro_rules! native_float {
    ($($t:ty)*) => {$(
        impl FtNative for $t {
            fn json(&self, out: &mut String) {
                // JSON has no NaN or infinity.
                if self.is_finite() { let _ = write!(out, "{:?}", self); } else { out.push_str(&str_lit(&self.to_string())); }
            }
        }
    )*};
}
native_float!(f32 f64);

impl FtNative for bool {
    fn json(&self, out: &mut String) {
        out.push_str(if *self { "true" } else { "false" });
    }
}
impl FtNative for char {
    fn json(&self, out: &mut String) {
        out.push_str(&str_lit(self.encode_utf8(&mut [0; 4])));
    }
}
impl FtNative for str {
    fn json(&self, out: &mut String) {
        crate::json::push_str_lit(out, self);
    }
}
impl FtNative for String {
    fn json(&self, out: &mut String) {
        self.as_str().json(out);
    }
}
impl FtNative for () {
    fn json(&self, out: &mut String) {
        out.push_str("null");
    }
}
impl<T: FtNative + ?Sized> FtNative for &T {
    fn json(&self, out: &mut String) {
        (**self).json(out);
    }
}
impl<T: FtNative + ?Sized> FtNative for &mut T {
    fn json(&self, out: &mut String) {
        (**self).json(out);
    }
}

fn max() -> usize {
    config::get().max_arg_length
}

/// The renderers append one JSON value to `out`.
#[doc(hidden)]
pub fn render_native<T: FtNative + ?Sized>(v: &T, out: &mut String) {
    let start = out.len();
    v.json(out);
    truncate_from(out, start, max());
}

#[doc(hidden)]
pub fn render_debug<T: Debug + ?Sized>(v: &T, out: &mut String) {
    let start = out.len();
    out.push('"');
    let mut w = Escaped::new(out, start, max());
    let _ = write!(w, "{v:?}");
    let overflowed = w.overflowed;
    if !overflowed {
        out.push('"');
    }
    // Redaction runs before truncation, as in every other layer. The cheap
    // substring test keeps the common value (no key in it) off the slow path.
    let cfg = config::get();
    if cfg.is_redacted(&out[start..]) {
        redact_rendered(out, start, !overflowed, &|k| cfg.is_redacted(k));
    }
    if overflowed {
        // The text was cut at the limit, so the value is truncated even when
        // redaction then shortened what is left to under it.
        crate::json::force_truncate_from(out, start, max());
    } else {
        truncate_from(out, start, max());
    }
}

#[doc(hidden)]
pub fn render_opaque<T: ?Sized>(_: &T, out: &mut String) {
    push_str_lit(out, &format!("<{}>", type_name::<T>()));
}

fn msg_display<E: Display + ?Sized>(e: &E) -> String {
    let mut b = Bounded::new(max());
    let _ = write!(b, "{e}");
    b.buf
}
fn msg_debug<E: Debug + ?Sized>(e: &E) -> String {
    let mut b = Bounded::new(max());
    let _ = write!(b, "{e:?}");
    b.buf
}
fn msg_opaque<E: ?Sized>(_: &E) -> String {
    "<error value not printable>".to_owned()
}

/// What an exit event reports about the return value.
#[doc(hidden)]
pub struct Outcome {
    pub(crate) result: String,
    pub(crate) error: Option<(String, String)>,
    /// `false` with `FLOWTRACE_CAPTURE_ARGS=0`: classify errors, skip rendering values.
    pub(crate) capture: bool,
}

impl Outcome {
    pub(crate) fn new(capture: bool) -> Self {
        Self { result: String::new(), error: None, capture }
    }
    /// Records the return value as `r0`, as the Go layer does. A unit value
    /// (rendered `null`) leaves `result` empty, i.e. `{}`.
    pub fn ok_with(&mut self, render: impl FnOnce(&mut String)) {
        self.result.push_str("\"r0\":");
        render(&mut self.result);
        if self.result.ends_with(":null") {
            self.result.clear();
        }
    }
    pub fn err(&mut self, kind: &str, msg: String) {
        self.error = Some((kind.to_owned(), msg));
    }
}

// ---- argument tiers: call as `(&&__FtP(&x)).ft_arg(out)` ----------------------

#[doc(hidden)]
pub trait ArgNative {
    fn ft_arg(self, out: &mut String);
}
#[doc(hidden)]
pub trait ArgDebug {
    fn ft_arg(self, out: &mut String);
}
#[doc(hidden)]
pub trait ArgOpaque {
    fn ft_arg(self, out: &mut String);
}
impl<T: FtNative + ?Sized> ArgNative for &&__FtP<'_, T> {
    fn ft_arg(self, out: &mut String) {
        render_native(self.0, out);
    }
}
impl<T: Debug + ?Sized> ArgDebug for &__FtP<'_, T> {
    fn ft_arg(self, out: &mut String) {
        render_debug(self.0, out);
    }
}
impl<T: ?Sized> ArgOpaque for __FtP<'_, T> {
    fn ft_arg(self, out: &mut String) {
        render_opaque(self.0, out);
    }
}

// ---- result tiers: call as `(&&&&&&&&&&&__FtP(&r)).ft_result(&mut o)` --------

macro_rules! result_tier {
    ($tr:ident, [$($r:tt)*], $tb:path, $tf:ident, $eb:path, $ef:ident) => {
        #[doc(hidden)]
        pub trait $tr { fn ft_result(self, o: &mut Outcome); }
        impl<T: $tb, E: $eb> $tr for $($r)* __FtP<'_, Result<T, E>> {
            fn ft_result(self, o: &mut Outcome) {
                match self.0 {
                    Ok(v) => if o.capture { o.ok_with(|out| $tf(v, out)) },
                    Err(e) => o.err(type_name::<E>(), $ef(e)),
                }
            }
        }
    };
}
result_tier!(R1, [& & & & & & & & & & &], FtNative, render_native, Display, msg_display);
result_tier!(R2, [& & & & & & & & & &],   FtNative, render_native, Debug,   msg_debug);
result_tier!(R3, [& & & & & & & & &],     FtNative, render_native, Sized,   msg_opaque);
result_tier!(R4, [& & & & & & & &],       Debug,    render_debug,  Display, msg_display);
result_tier!(R5, [& & & & & & &],         Debug,    render_debug,  Debug,   msg_debug);
result_tier!(R6, [& & & & & &],           Debug,    render_debug,  Sized,   msg_opaque);
result_tier!(R7, [& & & & &],             Sized,    render_opaque, Display, msg_display);
result_tier!(R8, [& & & &],               Sized,    render_opaque, Debug,   msg_debug);
result_tier!(R9, [& & &],                 Sized,    render_opaque, Sized,   msg_opaque);

#[doc(hidden)]
pub trait V1 {
    fn ft_result(self, o: &mut Outcome);
}
#[doc(hidden)]
pub trait V2 {
    fn ft_result(self, o: &mut Outcome);
}
#[doc(hidden)]
pub trait V3 {
    fn ft_result(self, o: &mut Outcome);
}
impl<T: FtNative + ?Sized> V1 for &&__FtP<'_, T> {
    fn ft_result(self, o: &mut Outcome) {
        if o.capture { o.ok_with(|out| render_native(self.0, out)); }
    }
}
impl<T: Debug + ?Sized> V2 for &__FtP<'_, T> {
    fn ft_result(self, o: &mut Outcome) {
        if o.capture { o.ok_with(|out| render_debug(self.0, out)); }
    }
}
impl<T: ?Sized> V3 for __FtP<'_, T> {
    fn ft_result(self, o: &mut Outcome) {
        if o.capture { o.ok_with(|out| render_opaque(self.0, out)); }
    }
}
