/**
 * Runtime helpers injected by the AST transform into every traced function.
 *
 * DEVIATION: This file uses CommonJS-compatible syntax (no top-level await,
 * works from both CJS and ESM contexts via dynamic import).  The emitter
 * and context modules use ESM; we import them lazily on first call so that
 * this file can be require()'d from CJS-transformed code as well.
 */

import { createRequire } from 'node:module';

import { getCurrent, runInSpan, storage } from './context.js';
import { emit } from './emitter.js';
import { newSpanId, newTraceId } from './ids.js';
import { rootSeed } from './propagation.js';

// High-resolution timestamp baseline established once at module load.
const BASELINE_MS = Date.now();
const BASELINE_HR = process.hrtime.bigint();

/**
 * Thread label for emitted events.
 *
 * This used to be the literal string 'main' in all three emit sites, which was
 * actively wrong rather than merely imprecise: bootstrap.mjs deliberately
 * propagates instrumentation into worker_threads via NODE_OPTIONS, so worker
 * events were emitted claiming to be on the main thread and a multi-threaded
 * trace could not be untangled at all. It was also the only layer not reporting
 * a real thread — Python uses threading.current_thread().name and Java uses the
 * JVM thread name.
 *
 * Resolved once per process: a worker's threadId never changes, and this is on
 * the hot path for every event. worker_threads is a builtin, so requiring it
 * costs nothing; threadId is 0 on the main thread.
 */
const THREAD_NAME = (() => {
  try {
    const { threadId } = createRequire(import.meta.url)('node:worker_threads');
    return threadId === 0 ? 'main' : `worker-${threadId}`;
  } catch {
    return 'main';
  }
})();

/**
 * Current wall-clock time as a fractional Unix seconds value with
 * sub-millisecond precision derived from hrtime.
 */
function nowTs() {
  const elapsed_ns = Number(process.hrtime.bigint() - BASELINE_HR);
  return BASELINE_MS / 1000 + elapsed_ns / 1e9;
}

/**
 * Serialize function arguments into a plain object for the trace event.
 * Param names are provided by the transform as an array; excess args
 * fall under "rest".
 *
 * @param {string[]} paramNames
 * @param {IArguments|Array} args
 * @returns {object}
 */
/**
 * Return the max-arg-length limit from env. 0 = no truncation. Default 512.
 * @returns {number}
 */
function getMaxArgLength() {
  const raw = process.env.FLOWTRACE_MAX_ARG_LENGTH;
  if (raw === undefined) return 512;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 512 : Math.max(0, n);
}

/**
 * If the JSON representation of a value exceeds maxArgLength, replace it
 * with a truncation marker string.
 * @param {*} value - Already JSON-safe value.
 * @returns {*}
 */
function truncateIfNeeded(value) {
  const maxLen = getMaxArgLength();
  if (maxLen === 0) return value;
  let s;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > maxLen) {
    return `<truncated:${s.slice(0, maxLen)}...>`;
  }
  return value;
}

/**
 * Maximum nesting depth walked when serializing a value. Cycle detection alone is
 * not enough: a deeply nested but acyclic structure would still be walked to
 * exhaustion.
 */
const MAX_DEPTH = 8;

/**
 * Convert an arbitrary JavaScript value into something JSON-safe.
 *
 * This replaces a `JSON.parse(JSON.stringify(v))` round-trip with a
 * `String(v)` fallback. That approach silently destroyed several everyday values,
 * because JSON.stringify has no representation for them and the catch branch was
 * reached only for values that made it *throw*:
 *
 *   - `new Error('boom')` -> `{}`. Errors have no enumerable own properties, so
 *     stringify succeeded and produced an empty object. Passing an error as an
 *     argument is common and losing it entirely is the opposite of useful.
 *   - `new Map([...])` and `new Set([...])` -> `{}`, for the same reason.
 *   - a function -> its full SOURCE TEXT, which after instrumentation includes
 *     FlowTrace's own injected `__ft_enter`/`__ft_run` scaffolding. Enormous, and
 *     it leaked the transform's internals into the user's trace.
 *   - `undefined` -> the literal string `"undefined"`, because
 *     JSON.stringify(undefined) returns undefined and JSON.parse then throws.
 *   - `NaN` / `Infinity` -> `null`, indistinguishable from an actual null.
 *   - a circular object -> `"[object Object]"`, losing every field.
 *
 * Python's serializer already produced informative output for the equivalent
 * values, so this was also a cross-language divergence: the same argument traced
 * in two languages disagreed about what it was.
 *
 * `seen` is threaded per PATH, not shared across the whole walk, so a value that
 * legitimately appears twice in sibling branches (a DAG) is serialized twice
 * rather than falsely reported as circular.
 *
 * @param {*} value
 * @param {Set<object>} [seen]
 * @param {number} [depth]
 */
function toJsonSafe(value, seen = new Set(), depth = 0) {
  if (value === undefined || value === null) return null;

  const type = typeof value;

  if (type === 'boolean' || type === 'string') return value;

  if (type === 'number') {
    // JSON has no NaN/Infinity; stringify turns both into null, which is
    // indistinguishable from a real null. Strings keep the information and stay
    // valid JSON. Python's layer emits the same strings.
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return value;
  }

  if (type === 'bigint') return `${value}n`;
  if (type === 'symbol') return String(value);
  if (type === 'function') {
    // Name only. Never the source: after instrumentation it contains our own
    // injected scaffolding.
    return `<function ${value.name || 'anonymous'}>`;
  }

  // ── objects ────────────────────────────────────────────────────────
  if (seen.has(value)) return '<circular>';
  if (depth >= MAX_DEPTH) return `<max depth ${MAX_DEPTH}>`;
  const nextSeen = new Set(seen).add(value);
  const recur = (v) => toJsonSafe(v, nextSeen, depth + 1);

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Map) {
    const out = {};
    for (const [k, v] of value) out[String(k)] = recur(v);
    return out;
  }
  if (value instanceof Set) return [...value].map(recur);
  if (Array.isArray(value)) return value.map(recur);

  // Plain-ish object. toJSON is honoured because a value that defines it has
  // told us how it wants to be represented.
  if (typeof value.toJSON === 'function') {
    try {
      return recur(value.toJSON());
    } catch {
      /* fall through to field walk */
    }
  }

  const out = {};
  for (const key of Object.keys(value)) {
    try {
      out[key] = recur(value[key]);
    } catch {
      // A throwing getter must not take the whole event down.
      out[key] = '<unreadable>';
    }
  }
  return out;
}

function serializeArgs(paramNames, args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = paramNames[i] ?? `arg${i}`;
    let safe;
    try {
      safe = toJsonSafe(args[i]);
    } catch {
      // Last resort, so an exotic value cannot cost us the event.
      safe = '<unserializable>';
    }
    out[key] = truncateIfNeeded(safe);
  }
  return out;
}

/**
 * Called at function entry.
 *
 * @param {string} module_   - Module/file identifier (basename without ext).
 * @param {string|null} cls  - Class name or null for plain functions.
 * @param {string} method    - Method/function name.
 * @param {string} visibility - "public" | "private".
 * @param {string[]} paramNames - Formal parameter names (for arg labeling).
 * @param {IArguments|Array} args - Actual arguments.
 * @param {'node'|'ts'} [lang='node'] - Supplied by the transform, which is the
 *   only place the source extension is known. Defaults to 'node' so a trace
 *   produced by an older transform still emits a schema-valid lang.
 * @returns {{ span_id: string, trace_id: string, parent_id: string|null, depth: number, lang: string, start: bigint }}
 */
export function __ft_enter(module_, cls, method, visibility, paramNames, args, lang = 'node') {
  // No in-process parent means this is a local root span. Before minting a
  // fresh trace_id, adopt any inbound W3C context (env seed or extracted HTTP
  // header) so the trace continues across the process/network boundary
  // instead of starting over. rootSeed()'s synthetic parent has depth -1, so
  // the arithmetic below still yields depth 0 for this span.
  const parent = getCurrent() ?? rootSeed();
  const span_id = newSpanId();
  const trace_id = parent ? parent.trace_id : newTraceId();
  const parent_id = parent ? parent.span_id : null;
  const depth = parent ? parent.depth + 1 : 0;

  // lang rides on the ctx so __ft_exit / __ft_exit_error can read it without
  // the transform having to thread it through their argument lists too.
  const ctx = { span_id, trace_id, parent_id, depth, lang, start: process.hrtime.bigint() };

  emit({
    ts: nowTs(),
    trace_id,
    span_id,
    parent_id,
    event: 'enter',
    thread: THREAD_NAME,
    lang,
    module: module_,
    // Coerced to '' rather than passed through. The schema types `class` as
    // string with no null permitted, so a plain (non-class) function emitting
    // class:null made EVERY one of its events schema-invalid — which is most
    // JavaScript. Python already emits '' here. The coercion lives in the
    // runtime and not only in the transform because transformed output is cached
    // on disk: users have cached modules that still pass null.
    class: cls ?? '',
    method,
    visibility,
    args: serializeArgs(paramNames, args),
    depth,
  });

  return ctx;
}

/**
 * Called at normal function exit.
 *
 * @param {{ span_id, trace_id, parent_id, depth, start }} ctx
 * @param {string} module_
 * @param {string|null} cls
 * @param {string} method
 * @param {string} visibility
 * @param {string[]} paramNames
 * @param {IArguments|Array} args
 * @param {*} result
 */
export function __ft_exit(ctx, module_, cls, method, visibility, paramNames, args, result) {
  const duration_ns = Number(process.hrtime.bigint() - ctx.start);
  let serializedResult;
  // undefined/null are checked BEFORE the JSON round-trip, not after. The
  // original order could never work: JSON.stringify(undefined) returns undefined,
  // JSON.parse of that throws, and the catch reported { value: "undefined" } —
  // the literal string. So every void function claimed to return the text
  // "undefined" instead of nothing, while Java and Python both emit {}.
  if (result === undefined || result === null) {
    serializedResult = {};
  } else {
    try {
      // Same serializer as the arguments: a returned Error, Map or circular
      // object deserves the same treatment as one passed in.
      serializedResult = { value: truncateIfNeeded(toJsonSafe(result)) };
    } catch {
      serializedResult = { value: '<unserializable>' };
    }
  }

  emit({
    ts: nowTs(),
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: ctx.parent_id,
    event: 'exit',
    thread: THREAD_NAME,
    lang: ctx.lang ?? 'node',
    module: module_,
    class: cls ?? '',
    method,
    visibility,
    args: serializeArgs(paramNames, args),
    result: serializedResult,
    duration_ns,
    depth: ctx.depth,
  });
}

/**
 * Called when a function exits via thrown exception.
 *
 * @param {{ span_id, trace_id, parent_id, depth, start }} ctx
 * @param {string} module_
 * @param {string|null} cls
 * @param {string} method
 * @param {string} visibility
 * @param {string[]} paramNames
 * @param {IArguments|Array} args
 * @param {Error|*} err
 */
export function __ft_exit_error(ctx, module_, cls, method, visibility, paramNames, args, err) {
  const duration_ns = Number(process.hrtime.bigint() - ctx.start);

  emit({
    ts: nowTs(),
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: ctx.parent_id,
    event: 'exit',
    thread: THREAD_NAME,
    lang: ctx.lang ?? 'node',
    module: module_,
    class: cls ?? '',
    method,
    visibility,
    args: serializeArgs(paramNames, args),
    // `result` is REQUIRED on every exit event, error exits included. Omitting
    // it made every error event schema-invalid — and tracing failures is the
    // whole point of this tool, so that is the worst possible path to break.
    // {} is the same shape a void return produces: there is no value to report.
    result: {},
    error: err && typeof err === 'object' ? {
      type: err.name ?? 'Error',
      msg: err.message ?? String(err),
      stack: (err.stack ?? '').split('\n').slice(0, 20),
    } : { type: 'unknown', msg: String(err), stack: [] },
    duration_ns,
    depth: ctx.depth,
  });
}

/**
 * Wraps fn execution inside a new span context so that nested calls
 * see the correct parent_id / depth.  The transform injects a call to
 * this around every traced function body.
 *
 * Returns the span ctx so the exit helper can be called with it.
 */
export function __ft_run(enterCtx, fn) {
  // Run the function inside a storage context so child calls inherit parent.
  const spanCtx = {
    trace_id: enterCtx.trace_id,
    span_id: enterCtx.span_id,
    depth: enterCtx.depth,
  };
  return storage.run(spanCtx, fn);
}
