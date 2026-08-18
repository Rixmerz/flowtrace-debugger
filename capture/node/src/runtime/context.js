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

/**
 * Seeds this process's trace from the FLOWTRACE_TRACEPARENT environment
 * variable, set by whatever spawned it.
 *
 * This is the receiving half of `subprocess.js`. HTTP carries trace context in
 * a header; a process spawn has no header, so the environment is the carrier.
 * The value is a plain W3C traceparent, and every runtime reads the same name,
 * so a Node parent can seed a Python or Java child and vice versa.
 *
 * The seeded span is synthetic and never emitted — the parent process already
 * emitted it. It sits at depth -1 for the same reason as in
 * runWithRemoteContext: the first *local* span then lands at depth 0, matching
 * an ordinary root and satisfying the schema's `depth >= 0`.
 *
 * Unlike runWithRemoteContext this does not scope the context to a callback:
 * there is no callback to scope it to. It sets the store for the lifetime of
 * the process, which is exactly the lifetime the parent's span covers.
 *
 * @param {string} [raw] - Defaults to process.env.FLOWTRACE_TRACEPARENT.
 * @returns {boolean} whether a valid context was adopted.
 */
export function seedFromEnvironment(raw = process.env.FLOWTRACE_TRACEPARENT) {
  const remote = parseTraceparent(raw);
  if (!remote) return false;
  storage.enterWith({
    trace_id: remote.trace_id,
    span_id: remote.parent_id,
    depth: -1,
    remote: true,
  });
  return true;
}
