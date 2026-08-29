/**
 * Types for the Angular bindings.
 *
 * Angular's own shapes are DUPLICATED structurally here rather than imported
 * from @angular/common/http. Depending on Angular would tie this package to an
 * Angular version range and pull the framework into the dependency graph of a
 * package whose whole design is to stay out of it. TypeScript is structural, so
 * a duplicated shape is assignable to the real one as long as it stays a subset
 * of what Angular declares — which is why each interface below lists only the
 * members the implementation actually touches.
 *
 * `Observable<any>` in the return position is load-bearing, not laziness.
 * Under `strictFunctionTypes` a return type is checked covariantly, so
 * `Observable<unknown>` would NOT be assignable to Angular's
 * `Observable<HttpEvent<unknown>>` and `withInterceptors([flowtraceInterceptor])`
 * would stop compiling.
 *
 * rxjs is imported type-only and appears in THIS file alone. It is an optional
 * peer dependency, so a non-Angular consumer that imports the core must never
 * be forced to resolve it — see the note in ./index.d.ts.
 */

import type { Observable } from 'rxjs';
import type { FlowtraceOptions } from './index.js';

/** The subset of Angular's `HttpRequest` the interceptor reads. */
export interface AngularHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: { has(name: string): boolean };
  clone(update: { setHeaders: Record<string, string> }): any;
}

/** The subset of Angular's `HttpHandlerFn`. */
export type AngularHttpHandlerFn = (req: any) => Observable<any>;

/**
 * Angular `HttpInterceptorFn`. Assignable to the real one, so it goes straight
 * into `provideHttpClient(withInterceptors([flowtraceInterceptor]))`.
 *
 * It returns the Observable Angular handed it, piped — not a Promise. That
 * distinction is the reason this file exists: an earlier version returned a
 * Promise, the request still succeeded, and every caller's subscribe() landed
 * on its error branch.
 */
export declare const flowtraceInterceptor: (
  req: AngularHttpRequest,
  next: AngularHttpHandlerFn,
) => Observable<any>;

/** Subscribes to Router events and records each navigation. */
export declare function instrumentRouter(router: {
  events: { subscribe: (fn: (e: any) => void) => any };
}): any;

/** An ErrorHandler that records the error and then delegates. */
export declare function createFlowtraceErrorHandler(
  delegate?: { handleError: (e: unknown) => void },
): { handleError(error: unknown): void };

/**
 * Provider factory. The Angular symbols are passed in rather than imported,
 * for the same reason the types above are duplicated.
 */
export declare function provideFlowtrace(
  options: FlowtraceOptions,
  ng: {
    provideAppInitializer: (fn: () => void) => any;
    inject: (token: any) => any;
    Router: any;
    ErrorHandler: any;
  },
): any[];

export declare function flush(): Promise<void>;
