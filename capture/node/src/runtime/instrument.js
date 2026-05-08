/**
 * Runtime helpers injected by the AST transform into every traced function.
 *
 * DEVIATION: This file uses CommonJS-compatible syntax (no top-level await,
 * works from both CJS and ESM contexts via dynamic import).  The emitter
 * and context modules use ESM; we import them lazily on first call so that
 * this file can be require()'d from CJS-transformed code as well.
 */

import { getCurrent, runInSpan, storage } from './context.js';
import { emit } from './emitter.js';
import { newSpanId, newTraceId } from './ids.js';

// High-resolution timestamp baseline established once at module load.
const BASELINE_MS = Date.now();
const BASELINE_HR = process.hrtime.bigint();

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

function serializeArgs(paramNames, args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = paramNames[i] ?? `arg${i}`;
    let safe;
    try {
      safe = JSON.parse(JSON.stringify(args[i]));
    } catch {
      safe = String(args[i]);
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
 * @returns {{ span_id: string, trace_id: string, parent_id: string|null, depth: number, start: bigint }}
 */
export function __ft_enter(module_, cls, method, visibility, paramNames, args) {
  const parent = getCurrent();
  const span_id = newSpanId();
  const trace_id = parent ? parent.trace_id : newTraceId();
  const parent_id = parent ? parent.span_id : null;
  const depth = parent ? parent.depth + 1 : 0;

  const ctx = { span_id, trace_id, parent_id, depth, start: process.hrtime.bigint() };

  emit({
    ts: nowTs(),
    trace_id,
    span_id,
    parent_id,
    event: 'enter',
    thread: 'main',
    lang: 'node',
    module: module_,
    class: cls,
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
  try {
    const v = JSON.parse(JSON.stringify(result));
    serializedResult = v === undefined || v === null ? {} : { value: v };
  } catch {
    serializedResult = { value: String(result) };
  }

  emit({
    ts: nowTs(),
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    parent_id: ctx.parent_id,
    event: 'exit',
    thread: 'main',
    lang: 'node',
    module: module_,
    class: cls,
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
    thread: 'main',
    lang: 'node',
    module: module_,
    class: cls,
    method,
    visibility,
    args: serializeArgs(paramNames, args),
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
