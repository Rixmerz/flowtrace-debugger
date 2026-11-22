//! The span guard spliced into instrumented functions.
//!
//! Context is a per-thread stack of the span being run: entering a span
//! reads the current one as its parent, and dropping the guard restores it.
//! There is no ambient context across threads or `.await` points in Rust (no
//! `AsyncLocalStorage`, no goroutine labels), so a span started on a new thread
//! is a root. See [`current_traceparent`] and [`remote_context`] to carry one
//! across by hand, the way the Python layer does.

use crate::config;
use crate::event::{self, fragment, ErrorInfo, Identity};
use crate::ids::{new_span_id, new_trace_id, SpanId, TraceId};
use crate::json::str_lit;
use std::borrow::Cow;
use std::sync::OnceLock;
use crate::probe::Outcome;
use crate::sink;
use crate::traceparent;
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;
use std::time::Instant;

/// The static description of an instrumented function.
#[doc(hidden)]
pub struct Meta {
    module: &'static str,
    class: &'static str,
    method: &'static str,
    visibility: &'static str,
    /// The escaped middle of every line this function writes, built on first use.
    fragment: OnceLock<String>,
}

impl Meta {
    pub const fn new(module: &'static str, class: &'static str, method: &'static str, visibility: &'static str) -> Self {
        Meta { module, class, method, visibility, fragment: OnceLock::new() }
    }

    fn fragment(&self) -> &str {
        self.fragment.get_or_init(|| fragment(self.module, self.class, self.method, self.visibility))
    }
}

/// The span a thread is currently inside. `span == 0` means none.
#[derive(Clone, Copy)]
struct Ctx {
    trace: TraceId,
    span: SpanId,
    depth: i32,
}

const NO_CTX: Ctx = Ctx { trace: 0, span: 0, depth: -1 };

thread_local! {
    static CTX: Cell<Ctx> = const { Cell::new(NO_CTX) };
    /// Set while this crate is rendering a value or writing an event, so the
    /// instrumented `Debug`/`Display` impls it calls do not trace themselves
    /// (which would recurse without end).
    static BUSY: Cell<bool> = const { Cell::new(false) };
    /// The thread name as a JSON string literal, escaped once per thread.
    static THREAD: String = str_lit(&thread_name());
    /// Spare strings for argument and result text, so a call does not allocate.
    static POOL: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// The `thread` field for the calling thread.
#[doc(hidden)]
pub fn thread_name() -> String {
    let t = std::thread::current();
    match t.name() {
        Some(n) => n.to_owned(),
        None => {
            let id = format!("{:?}", t.id());
            format!("thread-{}", id.trim_start_matches("ThreadId(").trim_end_matches(')'))
        }
    }
}

fn take_string() -> String {
    POOL.with(|p| p.borrow_mut().pop()).unwrap_or_default()
}

fn give_string(mut s: String) {
    // A huge value must not pin its buffer for the life of the thread.
    if s.capacity() <= 4096 {
        s.clear();
        POOL.with(|p| {
            let mut p = p.borrow_mut();
            if p.len() < 32 {
                p.push(s);
            }
        });
    }
}

struct Busy;
impl Busy {
    fn begin() -> Option<Busy> {
        BUSY.with(|b| if b.replace(true) { None } else { Some(Busy) })
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.with(|b| b.set(false));
    }
}

/// Collects the `args` object while the guard is being created.
#[doc(hidden)]
pub struct ArgsBuf {
    json: String,
}

impl ArgsBuf {
    /// Adds one argument. `render` runs only if the name is not redacted, so a
    /// secret is never even formatted. `name` is an identifier the rewriter
    /// emitted, so it needs no escaping.
    pub fn arg(&mut self, name: &str, render: &mut dyn FnMut(&mut String)) {
        if self.json.len() > 1 {
            self.json.push(',');
        }
        self.json.push('"');
        self.json.push_str(name);
        self.json.push_str("\":");
        if config::get().is_redacted(name) {
            self.json.push_str("\"<redacted>\"");
        } else {
            render(&mut self.json);
        }
    }
}

struct Live {
    trace: TraceId,
    span: SpanId,
    parent: Option<SpanId>,
    depth: u32,
    start: Instant,
    prev: Ctx,
    meta: &'static Meta,
    args: Cow<'static, str>,
    done: bool,
}

/// Open while a traced call runs. Dropping it closes the span.
///
/// `!Send`: it owns a slot in this thread's context stack.
#[doc(hidden)]
pub struct SpanGuard {
    live: Option<Live>,
    _not_send: PhantomData<*const ()>,
}

/// Opens a span. Everything here is deliberately not generic: a generic function
/// is compiled in the *caller's* crate, at the caller's optimisation level, and a
/// debug build of the traced program would run this whole path unoptimised on
/// every call. `dyn` callbacks keep it in the runtime, built with optimisations.
///
/// `args` fills in the arguments; it is skipped when values are not
/// captured. Returns an inert guard (and writes nothing) when this call is a
/// re-entrant one made by the runtime itself, or when the event cap is full.
#[doc(hidden)]
pub fn enter(meta: &'static Meta, args: &mut dyn FnMut(&mut ArgsBuf)) -> SpanGuard {
    let inert = SpanGuard { live: None, _not_send: PhantomData };
    // First, and cheapest: past the cap every call ends here.
    if !sink::admit() {
        return inert;
    }
    let Some(_busy) = Busy::begin() else { return inert };
    sink::ensure_init();
    let cfg = config::get();

    let args_json: Cow<'static, str> = if cfg.capture_values {
        let mut json = take_string();
        json.push('{');
        let mut buf = ArgsBuf { json };
        // Rendering runs the program's own `Debug` impls. If one panics, the
        // traced call must still run: the argument is lost, the program is not.
        let rendered = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            args(&mut buf);
            buf
        }));
        match rendered {
            Ok(mut b) => {
                b.json.push('}');
                Cow::Owned(b.json)
            }
            Err(_) => Cow::Borrowed("{\"<error>\":\"an argument's Debug impl panicked\"}"),
        }
    } else {
        Cow::Borrowed("{}")
    };

    let at = Instant::now();
    let prev = CTX.with(Cell::get);
    let (trace, parent, depth) = if prev.span != 0 {
        (prev.trace, Some(prev.span), (prev.depth + 1) as u32)
    } else if let Some((t, s)) = cfg.seed {
        // Launched under a caller's traceparent: this is the first local span, so
        // depth stays 0 and the remote span is its parent.
        (t, Some(s), 0)
    } else {
        (new_trace_id(), None, 0)
    };
    let span = new_span_id();

    THREAD.with(|thread| {
        event::write_enter(&Identity {
            trace,
            span,
            parent,
            thread,
            fragment: meta.fragment(),
            args: &args_json,
            depth,
            at,
        });
    });
    CTX.with(|c| c.set(Ctx { trace, span, depth: depth as i32 }));

    SpanGuard {
        live: Some(Live { trace, span, parent, depth, start: at, prev, meta, args: args_json, done: false }),
        _not_send: PhantomData,
    }
}

impl SpanGuard {
    /// Closes the span with the function's return value. `report` classifies it
    /// (see [`crate::probe`]); with values off it still classifies an `Err`.
    pub fn finish(mut self, report: &mut dyn FnMut(&mut Outcome)) {
        let Some(live) = self.live.as_mut() else { return };
        live.done = true;
        let capture = config::get().capture_values;
        let mut outcome = Outcome::new(capture);
        if capture {
            outcome.result = take_string();
        }
        if let Some(_busy) = Busy::begin() {
            // `report` runs the program's own `Debug`/`Display` impls; a panic in
            // one must not change what the program does.
            let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| report(&mut outcome)));
            if ok.is_err() {
                outcome = Outcome::new(capture);
                outcome.result = String::from("\"<error>\":\"a result's Debug impl panicked\"");
            }
        }
        write_exit(live, &outcome.result, outcome.error.as_ref().map(|(k, m)| (k.as_str(), m.as_str(), &[][..])));
        give_string(std::mem::take(&mut outcome.result));
    }
}

fn write_exit(live: &Live, result: &str, error: Option<(&str, &str, &[String])>) {
    let at = Instant::now();
    let duration = at.saturating_duration_since(live.start).as_nanos() as u64;
    THREAD.with(|thread| {
        event::write_exit(
            &Identity {
                trace: live.trace,
                span: live.span,
                parent: live.parent,
                thread,
                fragment: live.meta.fragment(),
                args: &live.args,
                depth: live.depth,
                at,
            },
            result,
            error.map(|(kind, msg, stack)| ErrorInfo { kind, msg, stack }),
            duration,
        );
    });
}

impl Drop for SpanGuard {
    fn drop(&mut self) {
        let Some(live) = self.live.as_mut() else { return };
        CTX.with(|c| c.set(live.prev));
        if live.done {
            if let Cow::Owned(args) = std::mem::replace(&mut live.args, Cow::Borrowed("")) {
                give_string(args);
            }
            return;
        }
        // Not finished: either the body unwound, or the function has no value
        // to report (guard-only mode). Unwinding is the only way to get here
        // while panicking.
        let _busy = Busy::begin();
        if std::thread::panicking() {
            let p = crate::panic::current();
            let (msg, stack) = p.map_or_else(|| ("panic".to_owned(), Vec::new()), |p| (p.msg, p.stack));
            write_exit(live, "", Some(("panic", &msg, &stack)));
        } else {
            write_exit(live, "", None);
        }
        if let Cow::Owned(args) = std::mem::replace(&mut live.args, Cow::Borrowed("")) {
            give_string(args);
        }
    }
}

/// The `traceparent` header for the span this thread is running, to attach to an
/// outgoing call by hand, or `None` outside any span.
pub fn current_traceparent() -> Option<String> {
    let c = CTX.with(Cell::get);
    (c.span != 0).then(|| traceparent::format(c.trace, c.span))
}

/// Restores the previous context when dropped. See [`remote_context`].
pub struct RemoteGuard {
    prev: Ctx,
    _not_send: PhantomData<*const ()>,
}

impl Drop for RemoteGuard {
    fn drop(&mut self) {
        CTX.with(|c| c.set(self.prev));
    }
}

/// Runs the calling thread inside a caller's trace until the guard drops.
/// Spans opened meanwhile take the header's `trace_id` and hang off its span.
/// This is the per-call counterpart of `FLOWTRACE_TRACEPARENT`, for a Rust
/// library called over FFI from a process that has its own trace. `None` if the
/// header is malformed.
pub fn remote_context(header: &str) -> Option<RemoteGuard> {
    let (trace, span) = traceparent::parse(header)?;
    // depth -1: the first local span below it sits at depth 0, the remote one
    // not being ours to emit.
    let prev = CTX.with(|c| c.replace(Ctx { trace, span, depth: -1 }));
    Some(RemoteGuard { prev, _not_send: PhantomData })
}
