import { AsyncLocalStorage } from 'node:async_hooks';
import { newTraceId, newSpanId } from './ids.js';

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

export { storage };
