/**
 * The operations a framework binding needs, as plain functions.
 *
 * All the logic lives here rather than inside an Angular interceptor or an
 * ErrorHandler subclass, because anything inside those can only be tested by
 * standing up a framework. Kept here, it is tested directly, and the Angular
 * layer shrinks to wiring — which is the part least likely to be wrong and the
 * part most expensive to test.
 */

import { startSpan, withSpan, seedFromRemote } from './context.js';
import { formatTraceparent, parseTraceparent } from './traceparent.js';
import { configure, emit, flush, installUnloadFlush } from './emitter.js';
import { httpEnter, httpExit, routeEnter, routeExit, errorPair, setRedactKeys } from './events.js';

let globalErrorsInstalled = false;

/** Monotonic nanoseconds where available, wall clock otherwise. */
function nowNs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() * 1e6;
  }
  return Date.now() * 1e6;
}

/**
 * Wraps one outbound HTTP call.
 *
 * Emits the enter immediately so a request that never completes — the page
 * closed, the server hung — still leaves evidence that it started. That
 * asymmetry is intentional and matches how the other layers read: an enter
 * with no exit means the process died inside that call.
 *
 * @param {{method: string, url: string}} req
 * @param {(traceparent: string|null) => Promise<{status?: number}>} send
 * @returns {Promise<any>} whatever `send` resolves to
 */
export async function traceHttp(req, send) {
  const span = traceHttpSpan(req);
  try {
    const res = await send(span.traceparent);
    span.end(res);
    return res;
  } catch (error) {
    span.end(null, error);
    throw error;
  }
}

/**
 * The same span as `traceHttp`, as a handle rather than a wrapper.
 *
 * `traceHttp` suits a caller that has a Promise. A caller that has something
 * else — an Observable it must hand back untouched, an EventSource — cannot
 * use it: converting to a Promise to satisfy the wrapper changes what the
 * caller returns, and that is how the Angular interceptor silently broke every
 * HttpClient call in an instrumented app. So the primitive is the handle, and
 * `traceHttp` is one caller of it.
 *
 * Shaped like `traceRoute`: emit on construction, `end` once, later ends
 * ignored. A handle that is never ended leaves an enter with no exit, which is
 * this schema's existing way of saying "started, never finished" — the honest
 * record for a request the caller cancelled.
 *
 * @param {{method: string, url: string}} req
 * @returns {{traceparent: string, end: (res?: {status?: number}|null, error?: unknown) => void}}
 */
export function traceHttpSpan(req) {
  const ctx = startSpan();
  emit(httpEnter(ctx, req));
  const started = nowNs();
  let ended = false;

  return {
    traceparent: formatTraceparent(ctx),
    end(res, error) {
      if (ended) return;
      ended = true;
      // An HTTP error carries a status too (Angular's HttpErrorResponse does),
      // and losing it would make a 404 indistinguishable from a network failure.
      const status = error
        ? (typeof error?.status === 'number' ? error.status : 0)
        : (typeof res?.status === 'number' ? res.status : 200);
      emit(httpExit(ctx, { ...req, status, durationNs: nowNs() - started, error }));
    },
  };
}

/**
 * Wraps one route change. `run` is optional: routers usually report start and
 * end as separate events, so `traceRoute` also works as a pair of calls via
 * the returned handle.
 *
 * @param {{from: string|null, to: string}} nav
 * @returns {{end: (error?: unknown) => void}}
 */
export function traceRoute(nav) {
  const ctx = startSpan();
  emit(routeEnter(ctx, nav));
  const started = nowNs();
  let ended = false;
  return {
    end(error) {
      // Routers can emit both a cancellation and an error for one navigation;
      // emitting two exits for one enter would corrupt the tree.
      if (ended) return;
      ended = true;
      emit(routeExit(ctx, { ...nav, durationNs: nowNs() - started, error }));
    },
  };
}

/** Records an unhandled error as an enter/exit pair carrying the error. */
export function reportError(err, where = 'unhandled') {
  const ctx = startSpan();
  for (const ev of errorPair(ctx, err, where)) emit(ev);
}

/**
 * One-call setup for a page.
 *
 * @param {object} options
 * @param {string} [options.endpoint] collector URL
 * @param {number} [options.batchSize]
 * @param {number} [options.flushIntervalMs]
 * @param {string} [options.traceparent] server-rendered traceparent, so the
 *   document request and everything the page does share one trace
 * @param {boolean} [options.captureGlobalErrors] hook window error events
 * @param {string[]} [options.redactKeys] extra key substrings to redact, on top
 *   of the shared default list
 *
 * Safe to call more than once (hydration, HMR, a re-mounted root): listeners
 * are installed a single time, so one unhandled error is one span, not two.
 */
export function initFlowtrace(options = {}) {
  configure(options);
  setRedactKeys(options.redactKeys ?? []);
  if (options.traceparent) seedFromRemote(parseTraceparent(options.traceparent));
  installUnloadFlush();

  if (options.captureGlobalErrors !== false && typeof addEventListener === 'function'
      && !globalErrorsInstalled) {
    globalErrorsInstalled = true;
    addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.onerror'));
    addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
  }
  return { flush };
}

/** Test seam: forget that listeners were installed. */
export function _resetInitForTests() {
  globalErrorsInstalled = false;
}

export { withSpan };
