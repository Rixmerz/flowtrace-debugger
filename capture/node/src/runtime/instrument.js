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
let _maxDepth = null;

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

/**
 * Deepest span FlowTrace will open, from FLOWTRACE_MAX_DEPTH. 0 = no limit.
 * Default 256.
 *
 * This is a stack budget before it is a trace-size knob. Measured on Node 22,
 * a plain recursion reaches ~8800 frames; the same recursion instrumented with
 * no limit reaches ~1100, and with a limit ~1700-1800. So the limit buys back
 * around half again, and no more: most of the cost is the rewrite itself —
 * every body becomes an arrow invoked through __ft_run, in a frame carrying
 * more locals — and that is paid whether or not a span is opened. Do not read
 * this knob as making deep recursion safe; read the *Stack depth* section of
 * capture/node/README.md, which states the 5-8x floor outright.
 *
 * 256 is far past what a call tree nests for real reasons — an Express
 * request handler is tens of levels deep, not hundreds — and far short of the
 * depth where the stack becomes the binding constraint. The levels below it
 * are also the ones nobody reads: a recursion 2000 deep emits 4000 events
 * that say the same thing.
 *
 * @returns {number} Infinity when unlimited.
 */
function getMaxDepth() {
  if (_maxDepth === null) {
    const raw = process.env.FLOWTRACE_MAX_DEPTH;
    if (raw === undefined) {
      _maxDepth = 256;
    } else {
      const n = parseInt(raw, 10);
      _maxDepth = isNaN(n) ? 256 : Math.max(0, n);
    }
    if (_maxDepth === 0) _maxDepth = Infinity;
  }
  return _maxDepth;
}

/** @internal Forget the cached env-derived config. */
export function _resetConfigForTests() {
  _maxArgLength = null;
  _redactKeys = null;
  _maxDepth = null;
  depthCeiling = getMaxDepth();
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
 * Objects visited per value before the rest is elided as "[Object]". Deep
 * user data is still walked whole; the cap only stops a pathological object
 * graph from costing more than the function being traced, since truncation
 * applies after the walk, not during it.
 */
const MAX_NODES = 500;

/**
 * A stable label for a value whose internals belong to the runtime rather
 * than to the program being traced, or null when the value should be walked.
 *
 * Walking an EventEmitter serializes Node's own private state. An Express
 * `req` serializes as `{"_events":{},"_readableState":{"highWaterMark":...`,
 * and `highWaterMark` alone went from 16384 to 65536 between Node majors.
 * None of that describes what the handler was called with, all of it spends
 * the argument budget before anything useful appears, and pinning it in a
 * golden fixture makes the fixture assert the Node version instead of the
 * capture. The constructor name is both stable and what a reader wants:
 * `<IncomingMessage>`.
 *
 * The duck-type is deliberately narrow (three EventEmitter methods) so that
 * an ordinary domain object still gets serialized in full.
 *
 * @param {object} v
 * @returns {string|null}
 */
function opaqueTag(v) {
  if (typeof v.on !== 'function'
    || typeof v.emit !== 'function'
    || typeof v.removeListener !== 'function') {
    return null;
  }
  const name = v.constructor && v.constructor.name;
  return `<${name || 'EventEmitter'}>`;
}

function toJsonSafe(value) {
  const seen = new WeakSet();
  let nodes = 0;
  const text = JSON.stringify(value, function replacer(key, v) {
    if (key !== '' && isRedactedKey(key)) return REDACTED;
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object') {
      const tag = opaqueTag(v);
      if (tag !== null) return tag;
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
// Failing open
// ────────────────────────────────────────────────────────────

/**
 * What `__ft_enter` returns when it could not open a span. The transform
 * passes it straight through to `__ft_run` and the exit helpers, which read it
 * as "this call is not traced".
 */
const NO_SPAN = null;

/**
 * Span depth past which __ft_run checks whether AsyncLocalStorage.run has the
 * stack to run at all, instead of assuming it.
 *
 * ALS.run costs about 3.3 frames per level (measured on Node 22), and when it
 * runs out it throws from inside its own machinery — before it has called the
 * traced function, so the program's body never runs and the error surfaces as
 * FlowTrace's, not theirs. The check needs a closure to tell that case from
 * the body throwing, and a closure per call is exactly the hot-path cost this
 * whole file is trying not to pay, so it is armed only where it can matter.
 *
 * 128 is far below the depth at which any of this becomes reachable (~1300
 * traced levels on a default Node 22 stack) and far above anything a call tree
 * reaches for real reasons — an Express request handler nests tens of levels,
 * not hundreds.
 */
const GUARD_FROM = 128;

/**
 * Calls FlowTrace gave up on, and the first reason it gave up.
 *
 * Counted rather than reported on the spot, and that is the whole trick. V8
 * hands a `catch` back only the frames it unwound to reach it, so a handler
 * that calls anything — `process.stderr.write` included — overflows again on
 * the way out, and the second RangeError escapes the try/catch that was
 * supposed to contain the first. That is not hypothetical: the first version
 * of this fix warned from the handler and crashed identically. The recovery
 * path therefore does nothing but an increment and an assignment, neither of
 * which needs a frame, and the line that explains it is printed from the exit
 * hook below, where the stack is whole again.
 */
let abandoned = 0;
/** @type {unknown} */
let abandonedCause = null;

/**
 * Calls FlowTrace declined to trace because they were deeper than the limit.
 *
 * Counted apart from `abandoned` because the two mean different things to
 * whoever reads the trace — one is the configured limit doing its job, the
 * other is the program at its stack ceiling — and a run can hit both.
 */
let skippedDeep = 0;

/**
 * Span depth at which tracing stops for the rest of the current call tree.
 *
 * Starts at getMaxDepth() and only ever ratchets DOWN, to the depth of a call
 * that ran out of stack before reaching the configured limit — a worker thread
 * or a `--stack-size` below the default gets there sooner. A root call (depth
 * 0) restores it, so one deep recursion does not mute tracing for the rest of
 * the process: a server starts each request at depth 0 and traces the next one
 * in full.
 *
 * The ratchet matters on its own. Without it, recovery oscillates and buys
 * almost nothing: abandoning one span frees the frames that span was holding,
 * so the next call has room, opens one, and runs out again a level later. The
 * program crawls along the same ceiling at the same cost per level and still
 * dies far short of the depth it reaches untraced.
 */
let depthCeiling = getMaxDepth();

/*
 * Why any of this exists.
 *
 * Every other patch in this runtime already fails open — propagate.js and
 * subprocess.js both say so in as many words — but the helpers the transform
 * injects did not, and they are the ones running inside the traced program's
 * own stack. Instrumentation spends several frames per call (__ft_run, the
 * AsyncLocalStorage.run inside it, the inner arrow), so a program with deep
 * recursion reaches V8's limit far sooner traced than untraced: measured on
 * Node 22, ~8800 frames of plain recursion against ~1300 instrumented, about
 * 6x. Past that depth `newSpanId()` threw RangeError from
 * node:internal/crypto/random — inside the traced program's stack, uncaught,
 * naming nothing the user wrote. A program that ran fine untraced died on
 * startup under `flowtrace run`, and the stack blamed Node's crypto internals.
 *
 * Abandoning the span makes the call untraced instead: __ft_run then invokes
 * the body directly, without the storage frames. That does not restore the
 * program's native depth — see getMaxDepth for what it does and does not buy —
 * but it does mean the program reaches its own ceiling and throws its own
 * catchable error there, instead of being killed by FlowTrace's. Calls nested
 * inside an abandoned one attach to the nearest ancestor that did open a span,
 * which leaves the tree connected and one level short rather than severed.
 */

// Deliberately at 'exit' and not at the point of failure: see `abandoned`
// above. emitter.js reports its own dropped writes the same way.
//
// The two causes get different lines because they call for different things.
// Hitting the depth limit is FlowTrace working as configured and the answer is
// a bigger limit; running out of stack is the program at its ceiling and the
// answer is to instrument less of it.
process.on('exit', () => {
  if (skippedDeep > 0) {
    process.stderr.write(
      `[flowtrace] ${skippedDeep} call(s) nested deeper than FLOWTRACE_MAX_DEPTH `
      + `(${getMaxDepth()}) and are missing from the trace; raise it to trace deeper.\n`
    );
  }
  if (abandoned > 0) {
    process.stderr.write(
      `[flowtrace] ${abandoned} call(s) ran untraced and are missing from the trace `
      + `(first cause: ${abandonedCause?.message ?? String(abandonedCause)}). `
      + `Instrumented code has roughly 5-8x less stack depth than the same code `
      + `untraced, so deep recursion runs out sooner — narrow --package-prefix, or `
      + `lower FLOWTRACE_MAX_DEPTH, to instrument less of the program.\n`
    );
  }
});

/** @internal Forget the abandoned-call tally. */
export function _resetAbandonedForTests() {
  abandoned = 0;
  abandonedCause = null;
  skippedDeep = 0;
  depthCeiling = getMaxDepth();
}

/** @internal Calls that ran untraced because a helper could not complete. */
export function abandonedCount() {
  return abandoned;
}

/** @internal Calls not traced because they were deeper than the limit. */
export function skippedDeepCount() {
  return skippedDeep;
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
  // The whole body is guarded, not just the id calls: serializeArgs and emit
  // are deeper still, and any of them running out of stack must cost the trace
  // a call, never the program a crash. See `abandoned`.
  let depth = 0;
  try {
    const parent = getCurrent();
    depth = parent ? parent.depth + 1 : 0;

    // Two integer comparisons on the hot path. See depthCeiling.
    if (depth === 0) {
      depthCeiling = getMaxDepth();
    } else if (depth >= depthCeiling) {
      skippedDeep++;
      return NO_SPAN;
    }

    const span_id = newSpanId();
    const trace_id = parent ? parent.trace_id : newTraceId();
    const parent_id = parent ? parent.span_id : null;

    const ctx = { span_id, trace_id, parent_id, depth, start: process.hrtime.bigint() };

    emit({
      ts: nowTs(),
      ...common(ctx, module_, cls, method, visibility, lang),
      event: 'enter',
      args: serializeArgs(paramNames, args),
      depth,
    });

    return ctx;
  } catch (e) {
    // No call, and no property read on `e`: see `abandoned`.
    abandoned++;
    abandonedCause ??= e;
    if (depth < depthCeiling) depthCeiling = depth;
    return NO_SPAN;
  }
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
  // No span was opened, so there is no enter event for this exit to close.
  if (ctx === NO_SPAN) return;

  try {
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
  } catch (e) {
    abandoned++;
    abandonedCause ??= e;
  }
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
  if (ctx === NO_SPAN) return;

  try {
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
  } catch (e) {
    // Never rethrow: the transform throws the program's own error on the very
    // next line, and ours would take its place.
    abandoned++;
    abandonedCause ??= e;
  }
}

/**
 * Wraps fn execution inside a new span context so that nested calls
 * see the correct parent_id / depth.  The transform injects a call to
 * this around every traced function body.
 *
 * Returns the span ctx so the exit helper can be called with it.
 */
export function __ft_run(enterCtx, fn) {
  // No span: run the body directly. Skipping storage.run also skips its
  // frames, which is the entire point when the reason there is no span is that
  // the stack ran out — this is what hands the program back its own depth.
  //
  // storage.run itself is not guarded: __ft_enter has just returned, and it is
  // by far the deeper of the two (ids, serializeArgs, JSON.stringify, the
  // write), so if there was stack for it there is stack for this. Guarding
  // here would need a flag to tell "threw before fn ran" from "fn threw", and
  // that flag plus its closure would cost a frame on every traced call —
  // making the problem it guards against more likely.
  if (enterCtx === NO_SPAN) return fn();

  // Run the function inside a storage context so child calls inherit parent.
  const spanCtx = {
    trace_id: enterCtx.trace_id,
    span_id: enterCtx.span_id,
    depth: enterCtx.depth,
  };

  // Shallow — the overwhelming majority of calls — takes the plain path, at
  // the cost of one integer comparison. See GUARD_FROM.
  if (enterCtx.depth < GUARD_FROM) return storage.run(spanCtx, fn);

  let entered = false;
  try {
    return storage.run(spanCtx, () => { entered = true; return fn(); });
  } catch (e) {
    // `entered` is what separates the two errors that arrive here: storage.run
    // running out of stack before it ever called fn, and fn throwing the
    // program's own error. Rethrowing the second is required; rethrowing the
    // first is the bug. Nothing weaker distinguishes them — by the time the
    // catch runs, the store is restored either way.
    if (entered) throw e;
    abandoned++;
    abandonedCause ??= e;
    if (enterCtx.depth < depthCeiling) depthCeiling = enterCtx.depth;
    return fn();
  }
}
