/**
 * Builds schema-v2 events for browser-shaped work.
 *
 * The schema has no browser concepts — no `kind`, no url, no component — and
 * `additionalProperties: false` means we cannot invent any. Adding fields would
 * mean a schema version bump that every capture layer and consumer has to move
 * in lockstep with, which is a large cost for a small gain.
 *
 * So browser work is mapped onto the fields that already exist:
 *
 *   module  the subsystem: "http" | "router" | "error"
 *   class   the resource: an HTTP path template, a route, an error's origin
 *   method  the operation: "GET", "navigate", the thrown type
 *   args    the inputs: url, params, navigation source
 *   result  the outcome: status, ok
 *   error   {type, msg, stack} on failure, exactly as the other layers emit it
 *
 * A trace mixing browser and server spans then reads uniformly, and every
 * existing tool — trace.tree, trace.find_error, the dashboard — works on it
 * with no changes.
 *
 * `lang` is "node": the schema's enum is java|node|python|ts and browser code
 * is JavaScript. It is not a perfect label, but inventing an enum value is the
 * same coordinated schema change this mapping exists to avoid.
 */

/** Epoch seconds with sub-second precision, matching every other layer. */
function now() {
  return Date.now() / 1000;
}

/**
 * Strips a URL down to something groupable: origin + path, no query or hash.
 * Query strings routinely carry tokens and personal data, and a trace is a file
 * that gets shared — so they are dropped rather than recorded.
 */
export function scrubUrl(raw) {
  try {
    const u = new URL(raw, typeof location !== 'undefined' ? location.href : 'http://localhost');
    return `${u.origin}${u.pathname}`;
  } catch {
    return typeof raw === 'string' ? raw.split('?')[0] : String(raw);
  }
}

/** Common fields for every browser event. */
function base(ctx, module_, cls, method) {
  return {
    ts: now(),
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: ctx.parent_id ?? null,
    thread: 'main',       // browsers are single-threaded per document
    lang: 'node',
    module: module_,
    class: cls,
    method: method,
    visibility: 'public',
    depth: ctx.depth,
  };
}

export function httpEnter(ctx, { method, url }) {
  return {
    ...base(ctx, 'http', scrubUrl(url), String(method || 'GET').toUpperCase()),
    event: 'enter',
    args: { url: scrubUrl(url) },
  };
}

export function httpExit(ctx, { method, url, status, durationNs, error }) {
  const ev = {
    ...base(ctx, 'http', scrubUrl(url), String(method || 'GET').toUpperCase()),
    event: 'exit',
    args: { url: scrubUrl(url) },
    result: error ? {} : { status: status ?? 0, ok: status >= 200 && status < 400 },
    duration_ns: Math.max(0, Math.round(durationNs)),
  };
  if (error) ev.error = toErrorObj(error);
  return ev;
}

export function routeEnter(ctx, { from, to }) {
  return {
    ...base(ctx, 'router', scrubUrl(to), 'navigate'),
    event: 'enter',
    args: { from: from ? scrubUrl(from) : null, to: scrubUrl(to) },
  };
}

export function routeExit(ctx, { from, to, durationNs, error }) {
  const ev = {
    ...base(ctx, 'router', scrubUrl(to), 'navigate'),
    event: 'exit',
    args: { from: from ? scrubUrl(from) : null, to: scrubUrl(to) },
    result: {},
    duration_ns: Math.max(0, Math.round(durationNs)),
  };
  if (error) ev.error = toErrorObj(error);
  return ev;
}

/**
 * An unhandled error has no duration and no matching enter — it is a point in
 * time. It is still emitted as an enter/exit pair, because the schema has no
 * third variant and every consumer walks pairs; the exit carries the error and
 * a zero duration.
 */
export function errorPair(ctx, err, where = 'unhandled') {
  const cls = err?.name || 'Error';
  return [
    { ...base(ctx, 'error', cls, where), event: 'enter', args: {} },
    {
      ...base(ctx, 'error', cls, where),
      event: 'exit',
      args: {},
      result: {},
      duration_ns: 0,
      error: toErrorObj(err),
    },
  ];
}

/** Normalizes anything throwable into the schema's error object. */
export function toErrorObj(err) {
  if (err && typeof err === 'object') {
    return {
      type: err.name || err.constructor?.name || 'Error',
      msg: String(err.message ?? err),
      stack: typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 20) : [],
    };
  }
  return { type: 'unknown', msg: String(err), stack: [] };
}
