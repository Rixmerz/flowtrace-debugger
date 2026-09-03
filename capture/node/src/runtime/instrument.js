/**
 * Runtime helpers injected by the AST transform into every traced function.
 *
 * DEVIATION: This file uses CommonJS-compatible syntax (no top-level await,
 * works from both CJS and ESM contexts via dynamic import).  The emitter
 * and context modules use ESM; we import them lazily on first call so that
 * this file can be require()'d from CJS-transformed code as well.
 */

import { isMainThread, threadId } from 'node:worker_threads';
import { getCurrent, storage } from './context.js';
import { emit } from './emitter.js';
import { newSpanId, newTraceId } from './ids.js';

// High-resolution timestamp baseline established once at module load.
const BASELINE_MS = Date.now();
const BASELINE_HR = process.hrtime.bigint();

/**
 * `thread` for every event of this thread. worker_threads inherit the
 * `--import` flag through NODE_OPTIONS, so they emit too — and used to claim
 * to be "main". The label mirrors Go's `goroutine-<n>`.
 */
const THREAD_LABEL = isMainThread ? 'main' : `worker-${threadId}`;

/**
 * Current wall-clock time as a fractional Unix seconds value with
 * sub-millisecond precision derived from hrtime.
 */
function nowTs() {
  const elapsed_ns = Number(process.hrtime.bigint() - BASELINE_HR);
  return BASELINE_MS / 1000 + elapsed_ns / 1e9;
}

// ────────────────────────────────────────────────────────────
// Configuration — read once. The knobs are process environment set by
// `flowtrace run` before the process starts; re-reading them on every value
// was pure hot-path cost. _resetConfigForTests() exists for the test suite.
// ────────────────────────────────────────────────────────────

/**
 * Key substrings whose values are never written to the trace. Identical to
 * capture/python and capture/go: the trace is designed to be pasted into an
 * AI conversation, which is the last place a credential should end up.
 */
const DEFAULT_REDACT_KEYS = [
  'password', 'secret', 'token', 'authorization',
  'api_key', 'url', 'dsn', 'connection_string', 'email',
];

const REDACTED = '<redacted>';

let _maxArgLength = null;
let _redactKeys = null;

/**
 * Max-arg-length limit from env. 0 = no truncation. Default 512.
 * @returns {number}
 */
function getMaxArgLength() {
  if (_maxArgLength === null) {
    const raw = process.env.FLOWTRACE_MAX_ARG_LENGTH;
    if (raw === undefined) {
      _maxArgLength = 512;
    } else {
      const n = parseInt(raw, 10);
      _maxArgLength = isNaN(n) ? 512 : Math.max(0, n);
    }
  }
  return _maxArgLength;
}

/**
 * Redact-key substrings, matched case-insensitively against argument names
 * and nested object keys. FLOWTRACE_REDACT_KEYS is a comma-separated list of
 * ADDITIONAL substrings — it extends the defaults, it never replaces them.
 * @returns {string[]}
 */
function getRedactKeys() {
  if (_redactKeys === null) {
    const keys = [...DEFAULT_REDACT_KEYS];
    for (const k of (process.env.FLOWTRACE_REDACT_KEYS ?? '').split(',')) {
      const key = k.trim().toLowerCase();
      if (key && !keys.includes(key)) keys.push(key);
    }
    _redactKeys = keys;
  }
  return _redactKeys;
}

/** @internal Forget the cached env-derived config. */
export function _resetConfigForTests() {
  _maxArgLength = null;
  _redactKeys = null;
}

function isRedactedKey(name) {
  const lowered = String(name).toLowerCase();
  return getRedactKeys().some((k) => lowered.includes(k));
}

// ────────────────────────────────────────────────────────────
// Serialization
// ────────────────────────────────────────────────────────────

/**
 * Convert an arbitrary runtime value into something JSON can carry, applying
 * redaction to nested object keys on the way.
 *
 * A JSON round-trip is used deliberately: it invokes toJSON(), drops functions
 * and symbols, and produces plain data the emitter can serialize again. The two
 * things JSON.stringify refuses — BigInt and cycles — are handled instead of
 * collapsing the whole value to "[object Object]".
 *
 * @param {*} value
 * @returns {*} JSON-safe value
 */
/**
 * Objects visited per value before the rest is elided as "[Object]". An
 * Express `req` reaches the socket, the server and the parser; walking all of
 * it on every handler call would cost more than the handler, and truncation
 * only applies after the walk. Well above anything a 512-char limit can show.
 */
const MAX_NODES = 500;

function toJsonSafe(value) {
  const seen = new WeakSet();
  let nodes = 0;
  const text = JSON.stringify(value, function replacer(key, v) {
    if (key !== '' && isRedactedKey(key)) return REDACTED;
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      if (++nodes > MAX_NODES) return Array.isArray(v) ? '[Array]' : '[Object]';
      seen.add(v);
    }
    return v;
  });
  return text === undefined ? undefined : JSON.parse(text);
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
  if (s !== undefined && s.length > maxLen) {
    return `<truncated:${s.slice(0, maxLen)}...>`;
  }
  return value;
}

/**
 * Serialize one argument or result value: redact, make JSON-safe, truncate.
 * Never throws — a value the trace cannot represent becomes a string.
 * @param {string} key - The name the value is recorded under.
 * @param {*} value
 */
function serializeValue(key, value) {
  if (isRedactedKey(key)) return REDACTED;
  let safe;
  try {
    safe = toJsonSafe(value);
  } catch {
    safe = String(value);
  }
  return truncateIfNeeded(safe);
}

/**
 * Serialize function arguments into a plain object for the trace event.
 * Param names are provided by the transform as an array; excess args
 * fall under positional argN keys.
 *
 * @param {string[]} paramNames
 * @param {IArguments|Array} args
 * @returns {object}
 */
function serializeArgs(paramNames, args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = paramNames[i] ?? `arg${i}`;
    out[key] = serializeValue(key, args[i]);
  }
  return out;
}

/**
 * Serialize a return value. `{}` for undefined/null (the schema requires an
 * object), `{value: X}` otherwise — the same shape as the Python and Java
 * layers. Result values obey the same redaction and truncation as arguments.
 * @param {*} result
 * @returns {object}
 */
function serializeResult(result) {
  if (result === undefined || result === null) return {};
  const v = serializeValue('value', result);
  return v === undefined || v === null ? {} : { value: v };
}

function errorInfo(err) {
  if (err && typeof err === 'object') {
    return {
      type: err.name ?? 'Error',
      msg: err.message ?? String(err),
      stack: (err.stack ?? '').split('\n').slice(0, 20),
    };
  }
  return { type: 'unknown', msg: String(err), stack: [] };
}

/**
 * The fields every event shares. `class` arrives as null for plain functions,
 * but the v2 schema types it as a required string, so it becomes "" — the
 * same encoding the Python layer uses.
 */
function common(ctx, module_, cls, method, visibility, lang) {
  return {
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: ctx.parent_id,
    thread: THREAD_LABEL,
    lang: lang ?? 'node',
    module: module_,
    class: cls ?? '',
    method,
    visibility,
  };
}

// ────────────────────────────────────────────────────────────
// Helpers called from transformed code
// ────────────────────────────────────────────────────────────

/**
 * Called at function entry.
 *
 * @param {string} module_   - Module/file identifier (basename without ext).
 * @param {string|null} cls  - Class name or null for plain functions.
 * @param {string} method    - Method/function name.
 * @param {string} visibility - "public" | "private".
 * @param {string[]} paramNames - Formal parameter names (for arg labeling).
 * @param {IArguments|Array} args - Actual arguments.
 * @param {string} [lang] - "node" (default) or "ts" for TypeScript sources.
 * @returns {{ span_id: string, trace_id: string, parent_id: string|null, depth: number, start: bigint }}
 */
export function __ft_enter(module_, cls, method, visibility, paramNames, args, lang) {
  const parent = getCurrent();
  const span_id = newSpanId();
  const trace_id = parent ? parent.trace_id : newTraceId();
  const parent_id = parent ? parent.span_id : null;
  const depth = parent ? parent.depth + 1 : 0;

  const ctx = { span_id, trace_id, parent_id, depth, start: process.hrtime.bigint() };

  emit({
    ts: nowTs(),
    ...common(ctx, module_, cls, method, visibility, lang),
    event: 'enter',
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
 * @param {string} [lang]
 */
export function __ft_exit(ctx, module_, cls, method, visibility, paramNames, args, result, lang) {
  const duration_ns = Number(process.hrtime.bigint() - ctx.start);

  emit({
    ts: nowTs(),
    ...common(ctx, module_, cls, method, visibility, lang),
    event: 'exit',
    args: serializeArgs(paramNames, args),
    result: serializeResult(result),
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
 * @param {string} [lang]
 */
export function __ft_exit_error(ctx, module_, cls, method, visibility, paramNames, args, err, lang) {
  const duration_ns = Number(process.hrtime.bigint() - ctx.start);

  emit({
    ts: nowTs(),
    ...common(ctx, module_, cls, method, visibility, lang),
    event: 'exit',
    args: serializeArgs(paramNames, args),
    // `result` is required on every exit event by schema v2. A call that threw
    // produced no value, and {} is already how a void/undefined return is
    // encoded.
    result: {},
    error: errorInfo(err),
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
