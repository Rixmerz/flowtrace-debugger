/**
 * Angular bindings for FlowTrace browser capture.
 *
 * This file is deliberately thin. Every decision — when a span starts, what
 * gets recorded, how an error is shaped, how the traceparent is rendered —
 * lives in ./api.js and is unit-tested there without Angular. What remains
 * here is wiring: converting Angular's shapes into that API's arguments.
 *
 * That split is the point. Testing this file means standing up TestBed,
 * zone.js and an HTTP mock backend; testing api.js means calling a function.
 * The logic that can be wrong is in the file you can test cheaply.
 *
 * Angular is a peer dependency and is NOT installed in this repo, so nothing
 * here is imported by the test suite. The imports below are the public,
 * long-stable Angular API surface (`provideAppInitializer`, `withInterceptors`,
 * `Router`, `ErrorHandler`), and they are typed loosely on purpose so this file
 * stays valid across Angular versions.
 *
 * ## Usage
 *
 * ```ts
 * // app.config.ts
 * import { provideHttpClient, withInterceptors } from '@angular/common/http';
 * import { provideFlowtrace, flowtraceInterceptor } from '@flowtrace/capture-browser/angular';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideHttpClient(withInterceptors([flowtraceInterceptor])),
 *     provideFlowtrace({ endpoint: 'http://localhost:8765/api/trace' }),
 *   ],
 * };
 * ```
 *
 * Change detection is not instrumented. Angular offers no supported hook for
 * it, the zoneless work has moved the ground under every unsupported one, and
 * a CD pass is far too frequent to record per-occurrence without dominating
 * the trace. HTTP, navigation and errors are where the questions actually are.
 */

import { traceHttp, traceRoute, reportError, initFlowtrace } from './api.js';
import { flush } from './emitter.js';

/**
 * Angular `HttpInterceptorFn`. Register through
 * `provideHttpClient(withInterceptors([flowtraceInterceptor]))`.
 *
 * Angular's HttpRequest is immutable, so the traceparent goes on via clone().
 * An existing header is left alone, matching the Node propagation rule: an app
 * doing its own propagation wins.
 */
export const flowtraceInterceptor = (req, next) => {
  return traceHttp({ method: req.method, url: req.url }, (traceparent) => {
    const outbound = traceparent && !req.headers.has('traceparent')
      ? req.clone({ setHeaders: { traceparent } })
      : req;

    // HttpClient hands back a cold Observable; traceHttp wants a Promise it can
    // await. Converting here rather than subscribing twice matters — a second
    // subscription would issue a second HTTP request.
    return new Promise((resolve, reject) => {
      let last;
      next(outbound).subscribe({
        next: (event) => { last = event; },
        error: reject,
        complete: () => resolve(last),
      });
    });
  });
};

/**
 * Subscribes to Router events and records each navigation.
 *
 * Angular reports a navigation's end three different ways — NavigationEnd,
 * NavigationCancel, NavigationError — and a single navigation can produce more
 * than one. The handle returned by traceRoute ignores a second end, so a
 * cancelled-then-errored navigation still yields one enter and one exit.
 *
 * @param {{events: {subscribe: (fn: (e: unknown) => void) => unknown}}} router
 */
export function instrumentRouter(router) {
  const open = new Map();
  return router.events.subscribe((event) => {
    const name = event?.constructor?.name;
    if (name === 'NavigationStart') {
      open.set(event.id, traceRoute({
        from: typeof location !== 'undefined' ? location.pathname : null,
        to: event.url,
      }));
      return;
    }
    if (name === 'NavigationEnd' || name === 'NavigationCancel' || name === 'NavigationError') {
      const handle = open.get(event.id);
      if (!handle) return;
      open.delete(event.id);
      handle.end(name === 'NavigationError' ? event.error : undefined);
    }
  });
}

/**
 * An Angular ErrorHandler that records the error and then delegates.
 *
 * Delegation is not optional: swallowing the error would change application
 * behaviour, and an instrumentation layer that alters what it observes is
 * worse than no instrumentation.
 *
 * @param {{handleError: (e: unknown) => void}} [delegate]
 */
export function createFlowtraceErrorHandler(delegate) {
  return {
    handleError(error) {
      try {
        reportError(error, 'angular.ErrorHandler');
      } catch { /* never let instrumentation mask the real error */ }
      if (delegate && typeof delegate.handleError === 'function') delegate.handleError(error);
      else console.error(error);
    },
  };
}

/**
 * Provider factory. Pass the result into an ApplicationConfig's `providers`.
 *
 * Takes its Angular symbols as arguments rather than importing them, so this
 * module stays importable — and testable — in an environment with no Angular
 * installed. The Angular-facing example in the file header shows the shape a
 * consuming app writes.
 *
 * @param {object} options forwarded to initFlowtrace
 * @param {object} ng     {provideAppInitializer, inject, Router, ErrorHandler}
 */
export function provideFlowtrace(options = {}, ng) {
  if (!ng) {
    throw new Error(
      'provideFlowtrace needs Angular symbols: ' +
      'provideFlowtrace(options, {provideAppInitializer, inject, Router, ErrorHandler})'
    );
  }
  const { provideAppInitializer, inject, Router, ErrorHandler } = ng;

  return [
    provideAppInitializer(() => {
      initFlowtrace(options);
      instrumentRouter(inject(Router));
    }),
    {
      provide: ErrorHandler,
      useFactory: () => createFlowtraceErrorHandler(),
    },
  ];
}

export { flush };
