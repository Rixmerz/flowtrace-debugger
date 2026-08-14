/**
 * Span context for the browser.
 *
 * The Node runtime uses AsyncLocalStorage, which has no browser equivalent —
 * Zone.js is the closest thing and Angular is actively moving away from it, so
 * depending on it would tie this package to a shrinking assumption.
 *
 * Instead the context is explicit: a stack for synchronous nesting, and a
 * handle you carry yourself across an async boundary. That is a real
 * limitation and it shapes what this package traces. It does not attempt to
 * instrument every function the way the Node and Python layers do; it records
 * the few events with a well-defined start and end — an HTTP request, a route
 * change, an unhandled error — where the caller can hold the handle across the
 * await without any ambient magic.
 */

import { newTraceId, newSpanId } from './ids.js';

/** @typedef {{trace_id: string, span_id: string, parent_id: string|null, depth: number}} SpanContext */

/** Synchronous nesting stack. Empty means no active span. */
const stack = [];

/** The page-wide trace id, so every span in one page load shares a trace. */
let pageTraceId = null;

/** @returns {SpanContext|null} */
export function getCurrent() {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Seeds the page's trace from a server-rendered traceparent, so a document
 * request and everything the page then does share one trace.
 * @param {{trace_id: string, parent_id: string}|null} remote
 */
export function seedFromRemote(remote) {
  if (!remote) return;
  pageTraceId = remote.trace_id;
  stack.length = 0;
  stack.push({
    trace_id: remote.trace_id,
    span_id: remote.parent_id,
    parent_id: null,
    depth: -1,   // the first local span then lands at 0, as in the Node runtime
    remote: true,
  });
}

/**
 * Creates a child of the current span without pushing it. Use this when the
 * span's lifetime is asynchronous: hold the returned context and pass it to
 * the matching exit yourself.
 * @returns {SpanContext}
 */
export function startSpan() {
  const parent = getCurrent();
  if (!parent && !pageTraceId) pageTraceId = newTraceId();
  return {
    trace_id: parent ? parent.trace_id : pageTraceId,
    span_id: newSpanId(),
    parent_id: parent ? parent.span_id : null,
    depth: parent ? parent.depth + 1 : 0,
  };
}

/**
 * Runs `fn` with `ctx` as the active span. Synchronous only — the stack is
 * popped when `fn` returns, so an un-awaited promise inside it escapes the
 * context by design rather than corrupting the stack for later work.
 * @template T
 * @param {SpanContext} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function withSpan(ctx, fn) {
  stack.push(ctx);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** Resets all context. Test seam; also useful for a SPA "new session". */
export function resetContext() {
  stack.length = 0;
  pageTraceId = null;
}

/** The trace every span on this page belongs to, minting one if needed. */
export function currentTraceId() {
  if (!pageTraceId) pageTraceId = newTraceId();
  return pageTraceId;
}
