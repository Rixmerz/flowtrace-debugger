/**
 * Convert FlowTrace v2 events to OTLP/JSON (ExportTraceServiceRequest), so a
 * trace can be opened in Jaeger, Tempo or any OTLP backend.
 *
 * No schema change is needed: v2 ids are already W3C Trace Context, so
 * trace_id / span_id / parent_id map one to one. Each enter/exit pair becomes
 * one span; a span whose exit was never recorded (the process died inside it)
 * is kept, zero-length, with flowtrace.incomplete=true rather than dropped —
 * a crash is exactly when someone wants to see it.
 *
 * args and result are exported as JSON-string attributes. They have already
 * been through capture-time redaction; run `flowtrace anonymize` first to
 * strip values entirely before sending a trace anywhere shared.
 */
'use strict';

const SPAN_KIND_INTERNAL = 1;
const STATUS_ERROR = 2;

function attr(key, value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { key, value: { intValue: String(value) } } : { key, value: { doubleValue: value } };
  }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

// ts is epoch seconds as a float; its precision is ~microseconds, so the
// start is rounded there and the end derived from duration_ns, which is exact.
function tsToNanos(ts) {
  return BigInt(Math.round(ts * 1e6)) * 1000n;
}

function toOtlp(events, opts = {}) {
  const serviceName = opts.serviceName || 'flowtrace';
  const spans = new Map();
  for (const e of events) {
    const key = `${e.trace_id}|${e.span_id}`;
    const cur = spans.get(key) || {};
    if (e.event === 'enter') cur.enter = e;
    else if (e.event === 'exit') cur.exit = e;
    spans.set(key, cur);
  }

  const byLang = new Map();
  for (const { enter, exit } of spans.values()) {
    const e = enter || exit;
    if (!e) continue;
    const start = tsToNanos(enter ? enter.ts : exit.ts - exit.duration_ns / 1e9);
    const end = exit ? start + BigInt(exit.duration_ns) : start;
    const namespace = [e.module, e.class].filter(Boolean).join('.');
    const attributes = [
      attr('code.function', e.method),
      attr('thread.name', e.thread),
      attr('flowtrace.visibility', e.visibility || 'unknown'),
      attr('flowtrace.depth', e.depth ?? 0),
    ];
    if (namespace) attributes.push(attr('code.namespace', namespace));
    if (enter && enter.args && Object.keys(enter.args).length) attributes.push(attr('flowtrace.args', JSON.stringify(enter.args)));
    if (exit && exit.result && Object.keys(exit.result).length) attributes.push(attr('flowtrace.result', JSON.stringify(exit.result)));
    if (!exit) attributes.push(attr('flowtrace.incomplete', true));

    const span = {
      traceId: e.trace_id,
      spanId: e.span_id,
      name: [e.class, e.method].filter(Boolean).join('.'),
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      attributes,
      status: {},
    };
    if (e.parent_id) span.parentSpanId = e.parent_id;
    if (exit && exit.error) {
      span.status = { code: STATUS_ERROR, message: exit.error.msg };
      span.events = [{
        name: 'exception',
        timeUnixNano: end.toString(),
        attributes: [
          attr('exception.type', exit.error.type),
          attr('exception.message', exit.error.msg),
          attr('exception.stacktrace', (exit.error.stack || []).join('\n')),
        ],
      }];
    }
    const list = byLang.get(e.lang) || [];
    list.push(span);
    byLang.set(e.lang, list);
  }

  const resourceSpans = [...byLang.entries()].map(([lang, list]) => ({
    resource: {
      attributes: [
        attr('service.name', serviceName),
        attr('telemetry.sdk.language', lang === 'ts' ? 'nodejs' : lang === 'node' ? 'nodejs' : lang),
        attr('flowtrace.lang', lang),
      ],
    },
    scopeSpans: [{ scope: { name: 'flowtrace', version: '2.0.0' }, spans: list }],
  }));
  return { resourceSpans };
}

module.exports = { toOtlp };
