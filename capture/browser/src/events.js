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
 * `lang` is "browser". It used to be "node" — the schema's enum had no better
 * value and adding one is a coordinated change — but a browser span labelled as
 * a Node span is a lie a consumer cannot detect, and the enum has since grown
 * `browser` for exactly this layer.
 */

/** Epoch seconds with sub-second precision, matching every other layer. */
function now() {
  return Date.now() / 1000;
}

/**
 * Key substrings whose values are never recorded — the same list as every
 * other capture layer, plus whatever `configure({ redactKeys })` adds. `url`
 * is on the shared list, but here the URL is the primary datum and is already
 * stripped of its query and hash by scrubUrl, so URL-valued args are exempt.
 * Path segments are recorded verbatim; a path that embeds a token is the
 * application's problem to route around, and is documented as such.
 */
const DEFAULT_REDACT_KEYS = [
  'password', 'secret', 'token', 'authorization',
  'api_key', 'url', 'dsn', 'connection_string', 'email',
];
const URL_ARGS = new Set(['url', 'from', 'to']);
let extraRedactKeys = [];

/** @param {string[]} keys additional substrings; additive, never a replacement */
export function setRedactKeys(keys = []) {
  extraRedactKeys = keys.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
}

function isRedactedKey(name) {
  const lowered = String(name).toLowerCase();
  return [...DEFAULT_REDACT_KEYS, ...extraRedactKeys].some((k) => lowered.includes(k));
}

/**
 * Applies the redaction rule to an args/result object (one level, plus nested
 * plain objects). Exported so a custom binding that records its own args gets
 * the same guarantee as the built-in events.
 */
export function redact(obj, { exemptUrls = true } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isRedactedKey(k) && !(exemptUrls && URL_ARGS.has(k))) {
      out[k] = '<redacted>';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v, { exemptUrls: false });
    } else {
      out[k] = v;
    }
  }
  return out;
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
    lang: 'browser',
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
    args: redact({ url: scrubUrl(url) }),
  };
}

export function httpExit(ctx, { method, url, status, durationNs, error }) {
  const ev = {
    ...base(ctx, 'http', scrubUrl(url), String(method || 'GET').toUpperCase()),
    event: 'exit',
    args: redact({ url: scrubUrl(url) }),
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
    args: redact({ from: from ? scrubUrl(from) : null, to: scrubUrl(to) }),
  };
}

export function routeExit(ctx, { from, to, durationNs, error }) {
  const ev = {
    ...base(ctx, 'router', scrubUrl(to), 'navigate'),
    event: 'exit',
    args: redact({ from: from ? scrubUrl(from) : null, to: scrubUrl(to) }),
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
