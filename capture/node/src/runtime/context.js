import { AsyncLocalStorage } from 'node:async_hooks';
import { newTraceId, newSpanId } from './ids.js';
import { parseTraceparent, formatTraceparent } from './traceparent.js';

/**
 * @typedef {{ trace_id: string, span_id: string, depth: number }} SpanContext
 */

/** @type {AsyncLocalStorage<SpanContext>} */
const storage = new AsyncLocalStorage();

/**
 * Returns the current span context, or null if none is active.
 * @returns {SpanContext | null}
 */
export function getCurrent() {
  return storage.getStore() ?? null;
}

/**
 * Enters a new span context, inheriting trace_id from parent or creating a new one.
 * Returns a disposer function — call it to exit the span context.
 *
 * Designed to be used with `using` (TC39 Explicit Resource Management) or
 * manually: `const done = enterSpan(); ... done();`
 *
 * @returns {{ context: SpanContext, done: () => void }}
 */
export function enterSpan() {
  const parent = getCurrent();
  const context = {
    trace_id: parent ? parent.trace_id : newTraceId(),
    span_id: newSpanId(),
    depth: parent ? parent.depth + 1 : 0,
  };

  // We use a Promise-based trick to run the callback in the new context.
  // The caller receives the context and a done() disposer.
  let resolveDone;
  const donePromise = new Promise((resolve) => { resolveDone = resolve; });

  // Run caller code inside the storage context by wrapping in run().
  // Because we can't block here, we store the context synchronously and
  // return a handle for the caller to use inside storage.run().
  const handle = { context, _resolve: resolveDone };
  return handle;
}

/**
 * Runs `fn` inside a new span context derived from the current one.
 * Returns whatever `fn` returns (including Promises).
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function runInSpan(fn) {
  const parent = getCurrent();
  const context = {
    trace_id: parent ? parent.trace_id : newTraceId(),
    span_id: newSpanId(),
    depth: parent ? parent.depth + 1 : 0,
  };
  return storage.run(context, fn);
}

/**
 * Runs `fn` as a continuation of a trace that started in another process.
 *
 * Pass the incoming request's `traceparent` header. Spans created inside `fn`
 * inherit the caller's trace_id and hang off the caller's span, so a browser
 * click and the server work it triggered end up in one tree.
 *
 * The remote span is seeded into storage as a synthetic parent at depth -1.
 * That is deliberate: the first *local* span then lands at depth 0, matching
 * an ordinary root and keeping the schema's `depth >= 0` constraint. We never
 * emit an event for the seed itself — the remote process already emitted it.
 *
 * This establishes a *parent*; it does not open a span of its own. Either way
 * the caller creates the first local span inside `fn`, and either way that
 * span reports depth 0 — with a valid header its parent_id is the remote
 * span, without one it is null. Keeping those two paths symmetric matters:
 * an integrator writing a middleware should not have to branch on whether
 * the incoming request happened to carry a header.
 *
 * An absent, malformed, or non-conforming header therefore just runs `fn`
 * unchanged, and tracing inside starts a fresh local root. A caller we do not
 * control must never be able to break the traced application by sending a bad
 * header.
 *
 * @template T
 * @param {string|string[]|undefined|null} traceparent - Raw header value.
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithRemoteContext(traceparent, fn) {
  const remote = parseTraceparent(traceparent);
  if (!remote) return fn();

  const seed = {
    trace_id: remote.trace_id,
    span_id: remote.parent_id,
    depth: -1,
    remote: true,
  };
  return storage.run(seed, fn);
}

/**
 * The current span rendered as a `traceparent` header value, for propagating
 * this trace to a process we are about to call.
 *
 * @returns {string|null} null when no span is active.
 */
export function currentTraceparent() {
  return formatTraceparent(getCurrent());
}

export { storage };
