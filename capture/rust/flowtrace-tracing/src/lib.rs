//! A [`tracing_subscriber`] layer that writes the spans of a program that already
//! uses `tracing` as FlowTrace v2 JSONL, in the same file, shape and environment
//! contract as the rest of the Rust layer (see the `flowtrace` crate).
//!
//! ```ignore
//! use tracing_subscriber::prelude::*;
//! tracing_subscriber::registry().with(flowtrace_tracing::FlowtraceLayer::new()).init();
//! ```
//!
//! It is a layer, not a subscriber, on purpose: it composes with whatever the
//! program installs already, and never installs a global default of its own
//! (a second `init()` in the program would panic).
//!
//! What a `tracing` span becomes:
//!
//! | `tracing` | FlowTrace |
//! |---|---|
//! | span name | `method` |
//! | `module_path` (else target) | `module` |
//! | span fields | `args`, by name (numbers, bools and strings natively, `Debug` otherwise) |
//! | first `enter` | `enter` event |
//! | span closing | `exit` event, `duration_ns` measured from the first enter |
//! | `#[instrument(err)]` event (`ERROR` level, `error` field) | the exit's `error` |
//! | `#[instrument(ret)]` event (`return` field) | the exit's `result` as `r0` |
//! | a panic unwinding through the span | the exit's `error`, type `panic` |
//!
//! A span that is created but never entered writes nothing. `class` is always
//! empty and `visibility` is `unknown`: `tracing` records neither.
//!
//! `FLOWTRACE_PACKAGE_PREFIX` (or [`FlowtraceLayer::with_prefix`]) keeps only
//! spans whose module path starts with it; the children of a dropped span hang
//! off its nearest kept ancestor.

use flowtrace::__rt::{self as rt, ErrorInfo, Identity, SpanId, TraceId};
use std::fmt::Write as _;
use std::time::Instant;
use tracing_core::field::{Field, Visit};
use tracing_core::span::{Attributes, Id, Record};
use tracing_core::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::{LookupSpan, SpanRef};
use tracing_subscriber::Layer;

/// See the crate documentation.
#[derive(Debug, Clone, Default)]
pub struct FlowtraceLayer {
    prefix: String,
}

impl FlowtraceLayer {
    /// Reads `FLOWTRACE_PACKAGE_PREFIX`, like the other capture layers.
    pub fn new() -> Self {
        Self { prefix: std::env::var("FLOWTRACE_PACKAGE_PREFIX").unwrap_or_default() }
    }

    /// Keeps only spans whose module path starts with `prefix`.
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }
}

struct Data {
    trace: TraceId,
    span: SpanId,
    parent: Option<SpanId>,
    depth: u32,
    module: String,
    method: String,
    /// `(name, rendered JSON value)` in the order first seen.
    args: Vec<(String, String)>,
    started: Option<Instant>,
    result: Option<String>,
    error: Option<(String, String, Vec<String>)>,
}

impl Data {
    fn args_json(&self) -> String {
        let mut out = String::from("{");
        for (i, (k, v)) in self.args.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&rt::str_lit(k));
            out.push(':');
            out.push_str(v);
        }
        out.push('}');
        out
    }

    fn identity<'a>(&'a self, thread: &'a str, fragment: &'a str, args: &'a str) -> Identity<'a> {
        Identity { trace: self.trace, span: self.span, parent: self.parent, thread, fragment, args, depth: self.depth, at: Instant::now() }
    }

    fn fragment(&self) -> String {
        rt::fragment(&self.module, "", &self.method, "unknown")
    }
}

/// Renders field values the way the runtime renders arguments.
#[derive(Default)]
struct Fields {
    values: Vec<(String, String)>,
    /// The unquoted text of string-like values, for error messages.
    texts: Vec<(String, String)>,
}

impl Fields {
    fn put(&mut self, field: &Field, json: String) {
        let name = field.name();
        let cfg = rt::config();
        let json = if cfg.is_redacted(name) { "\"<redacted>\"".to_owned() } else { rt::truncate(json, cfg.max_arg_length) };
        match self.values.iter_mut().find(|(k, _)| k == name) {
            Some(slot) => slot.1 = json,
            None => self.values.push((name.to_owned(), json)),
        }
    }
    fn text(&mut self, field: &Field, text: &str) {
        self.texts.push((field.name().to_owned(), text.to_owned()));
    }
    fn get(&self, name: &str) -> Option<&str> {
        self.values.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn get_text(&self, name: &str) -> Option<&str> {
        self.texts.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

impl Visit for Fields {
    fn record_i64(&mut self, f: &Field, v: i64) {
        self.put(f, v.to_string());
    }
    fn record_u64(&mut self, f: &Field, v: u64) {
        self.put(f, v.to_string());
    }
    fn record_i128(&mut self, f: &Field, v: i128) {
        self.put(f, v.to_string());
    }
    fn record_u128(&mut self, f: &Field, v: u128) {
        self.put(f, v.to_string());
    }
    fn record_f64(&mut self, f: &Field, v: f64) {
        self.put(f, if v.is_finite() { format!("{v:?}") } else { rt::str_lit(&v.to_string()) });
    }
    fn record_bool(&mut self, f: &Field, v: bool) {
        self.put(f, v.to_string());
    }
    fn record_str(&mut self, f: &Field, v: &str) {
        self.text(f, v);
        self.put(f, rt::str_lit(v));
    }
    fn record_error(&mut self, f: &Field, v: &(dyn std::error::Error + 'static)) {
        self.text(f, &v.to_string());
        self.put(f, rt::str_lit(&v.to_string()));
    }
    fn record_debug(&mut self, f: &Field, v: &dyn std::fmt::Debug) {
        let mut text = String::new();
        let _ = write!(text, "{v:?}");
        // Same rule as the runtime: a nested field named like a secret is redacted.
        let cfg = rt::config();
        if cfg.is_redacted(&text) {
            if let Some(red) = rt::redact_debug(&text, &|k| cfg.is_redacted(k)) {
                text = red;
            }
        }
        self.text(f, &text);
        // `#[instrument(ret)]` records numbers through Debug: keep them numbers.
        let json = if text.parse::<f64>().is_ok_and(f64::is_finite) || text == "true" || text == "false" {
            text
        } else {
            rt::str_lit(&text)
        };
        self.put(f, json);
    }
}

/// The nearest span at or above `id` that this layer is tracking.
fn nearest<'a, S: LookupSpan<'a>>(span: SpanRef<'a, S>) -> Option<SpanRef<'a, S>> {
    span.scope().find(|s| s.extensions().get::<Data>().is_some())
}

impl<S> Layer<S> for FlowtraceLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let meta = span.metadata();
        let module = meta.module_path().unwrap_or_else(|| meta.target());
        if !module.starts_with(&self.prefix) || !rt::admit() {
            return;
        }
        rt::ensure_init();

        let inherited = span
            .parent()
            .and_then(nearest)
            .and_then(|p| p.extensions().get::<Data>().map(|d| (d.trace, d.span, d.depth)));
        let (trace, parent, depth) = match inherited {
            Some((t, s, d)) => (t, Some(s), d + 1),
            None => match rt::config().seed {
                Some((t, s)) => (t, Some(s), 0),
                None => (rt::new_trace_id(), None, 0),
            },
        };

        let mut fields = Fields::default();
        attrs.record(&mut fields);
        span.extensions_mut().insert(Data {
            trace,
            span: rt::new_span_id(),
            parent,
            depth,
            module: module.to_owned(),
            method: meta.name().to_owned(),
            args: fields.values,
            started: None,
            result: None,
            error: None,
        });
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        if let Some(d) = ext.get_mut::<Data>() {
            let mut fields = Fields::default();
            values.record(&mut fields);
            for (k, v) in fields.values {
                match d.args.iter_mut().find(|(n, _)| *n == k) {
                    Some(slot) => slot.1 = v,
                    None => d.args.push((k, v)),
                }
            }
        }
    }

    fn on_enter(&self, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        let Some(d) = ext.get_mut::<Data>() else { return };
        if d.started.is_some() {
            return;
        }
        d.started = Some(Instant::now());
        let (thread, fragment, args) = (rt::str_lit(&rt::thread_name()), d.fragment(), d.args_json());
        rt::write_enter(&d.identity(&thread, &fragment, &args));
    }

    fn on_exit(&self, id: &Id, ctx: Context<'_, S>) {
        if !std::thread::panicking() {
            return;
        }
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        if let Some(d) = ext.get_mut::<Data>() {
            let (msg, stack) = rt::panic_info().map_or_else(|| ("panic".to_owned(), Vec::new()), |p| (p.msg, p.stack));
            d.error = Some(("panic".to_owned(), msg, stack));
        }
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let is_error = *event.metadata().level() == Level::ERROR;
        let mut fields = Fields::default();
        event.record(&mut fields);
        let (error, ret) = (fields.get_text("error").filter(|_| is_error), fields.get("return"));
        if error.is_none() && ret.is_none() {
            return;
        }
        let Some(span) = ctx.event_span(event).and_then(nearest) else { return };
        let mut ext = span.extensions_mut();
        let Some(d) = ext.get_mut::<Data>() else { return };
        if let Some(e) = error {
            d.error = Some(("error".to_owned(), e.to_owned(), Vec::new()));
        }
        if let Some(r) = ret {
            d.result = Some(format!("\"r0\":{r}"));
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let Some(d) = span.extensions_mut().remove::<Data>() else { return };
        // Never entered: there is no `enter` to pair an `exit` with.
        let Some(started) = d.started else { return };
        let (thread, fragment, args) = (rt::str_lit(&rt::thread_name()), d.fragment(), d.args_json());
        let error = d.error.as_ref().map(|(kind, msg, stack)| ErrorInfo { kind, msg, stack });
        rt::write_exit(&d.identity(&thread, &fragment, &args), d.result.as_deref().unwrap_or(""), error, started.elapsed().as_nanos() as u64);
    }
}
