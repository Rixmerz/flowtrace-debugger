/**
 * Types for the framework-agnostic core.
 *
 * Hand-written rather than generated, because this layer ships as plain .js —
 * there is no build step to emit declarations from, and adding one would put a
 * compiler between the source and the vendored copy the CLI carries.
 *
 * Nothing here imports from a framework, and deliberately nothing imports from
 * rxjs either: rxjs is an OPTIONAL peer dependency, present only in an Angular
 * app. A React or vanilla consumer must be able to resolve these types, so the
 * rxjs import lives in ./angular.d.ts alone — the same split that already holds
 * at runtime between index.js and angular.js.
 */

export interface SpanContext {
  trace_id: string;
  span_id: string;
  parent_id: string | null;
  depth: number;
}

export interface FlowtraceOptions {
  /** Collector URL, e.g. http://localhost:8765/api/trace */
  endpoint?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  /** A server-rendered traceparent, so the document request and the page share one trace. */
  traceparent?: string;
  /** Defaults to true. */
  captureGlobalErrors?: boolean;
  maxQueue?: number;
}

/** One outbound HTTP call, wrapped. `send` receives the traceparent to forward. */
export declare function traceHttp<T extends { status?: number }>(
  req: { method: string; url: string },
  send: (traceparent: string) => Promise<T>,
): Promise<T>;

/**
 * The same span as traceHttp, as a handle rather than a wrapper.
 *
 * Use this when the caller must hand back something that is not a Promise — an
 * Observable, an AbortController-driven fetch. Converting to a Promise to
 * satisfy traceHttp changes what the caller returns, which is how the Angular
 * interceptor once broke every HttpClient call in an instrumented app.
 *
 * A handle that is never ended leaves an enter with no exit: this schema's way
 * of saying "started, never finished", which is the honest record for a
 * request the caller cancelled.
 */
export declare function traceHttpSpan(
  req: { method: string; url: string },
): {
  traceparent: string;
  end(res?: { status?: number } | null, error?: unknown): void;
};

export declare function traceRoute(
  nav: { from: string | null; to: string },
): { end(error?: unknown): void };

export declare function reportError(err: unknown, where?: string): void;

export declare function initFlowtrace(options?: FlowtraceOptions): { flush: () => Promise<void> };

export declare function withSpan<T>(ctx: SpanContext, fn: () => T): T;
export declare function startSpan(): SpanContext;
export declare function getCurrent(): SpanContext | null;
export declare function seedFromRemote(remote: SpanContext | null): void;
export declare function resetContext(): void;
export declare function currentTraceId(): string | null;

export declare function newTraceId(): string;
export declare function newSpanId(): string;
export declare function parseTraceparent(header: string): SpanContext | null;
export declare function formatTraceparent(ctx: SpanContext): string;

export declare function configure(options: FlowtraceOptions): void;
export declare function emit(event: object): void;
export declare function flush(): Promise<void>;
export declare function installUnloadFlush(): void;
export declare function resetEmitter(): void;
export declare function queueDepth(): number;
export declare function droppedCount(): number;

export declare function httpEnter(ctx: SpanContext, req: { method: string; url: string }): object;
export declare function httpExit(ctx: SpanContext, req: object): object;
export declare function routeEnter(ctx: SpanContext, nav: object): object;
export declare function routeExit(ctx: SpanContext, nav: object): object;
export declare function errorPair(ctx: SpanContext, err: unknown, where: string): object[];
export declare function toErrorObj(err: unknown): { type: string; msg: string; stack?: string };
export declare function scrubUrl(raw: unknown): string;
