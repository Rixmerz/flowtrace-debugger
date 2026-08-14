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
import { httpEnter, httpExit, routeEnter, routeExit, errorPair } from './events.js';

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
  const ctx = startSpan();
  emit(httpEnter(ctx, req));
  const started = nowNs();
  const traceparent = formatTraceparent(ctx);

  try {
    const res = await send(traceparent);
    emit(httpExit(ctx, {
      ...req,
      status: typeof res?.status === 'number' ? res.status : 200,
      durationNs: nowNs() - started,
    }));
    return res;
  } catch (error) {
    // An HTTP error carries a status too (Angular's HttpErrorResponse does),
    // and losing it would make a 404 indistinguishable from a network failure.
    emit(httpExit(ctx, {
      ...req,
      status: typeof error?.status === 'number' ? error.status : 0,
      durationNs: nowNs() - started,
      error,
    }));
    throw error;
  }
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
 */
export function initFlowtrace(options = {}) {
  configure(options);
  if (options.traceparent) seedFromRemote(parseTraceparent(options.traceparent));
  installUnloadFlush();

  if (options.captureGlobalErrors !== false && typeof addEventListener === 'function') {
    addEventListener('error', (e) => reportError(e.error ?? e.message, 'window.onerror'));
    addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
  }
  return { flush };
}

export { withSpan };
