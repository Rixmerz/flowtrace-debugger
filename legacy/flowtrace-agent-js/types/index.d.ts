/**
 * FlowTrace Agent - TypeScript Definitions
 * Multi-language debugging and performance analysis system
 *
 * @author Juan Pablo Diaz <juanpablo516@gmail.com>
 * @license MIT
 */

/// <reference path="./config.d.ts" />
/// <reference path="./logger.d.ts" />
/// <reference path="./decorators.d.ts" />

declare module 'flowtrace-agent-js' {
  /**
   * FlowTrace Agent main interface
   */
  export interface FlowTraceAgent {
    /**
     * Initialize FlowTrace instrumentation
     */
    init(config?: FlowTraceConfig): void;

    /**
     * Manually instrument a function
     */
    trace<T extends (...args: any[]) => any>(
      fn: T,
      options?: TraceOptions
    ): T;

    /**
     * Get current configuration
     */
    getConfig(): FlowTraceConfig;

    /**
     * Flush logs to file
     */
    flush(): Promise<void>;

    /**
     * Stop instrumentation and cleanup
     */
    stop(): void;
  }

  /**
   * Options for manual tracing
   */
  export interface TraceOptions {
    /**
     * Class name for the traced function
     */
    className?: string;

    /**
     * Method/function name override
     */
    methodName?: string;

    /**
     * Whether to capture arguments
     * @default true
     */
    captureArgs?: boolean;

    /**
     * Whether to capture return value
     * @default true
     */
    captureResult?: boolean;

    /**
     * Whether to capture exceptions
     * @default true
     */
    captureExceptions?: boolean;
  }

  /**
   * Log event types
   */
  export type EventType = 'ENTER' | 'EXIT';

  /**
   * Log entry structure (JSONL format)
   */
  export interface LogEntry {
    /**
     * Unix timestamp in milliseconds
     */
    timestamp: number;

    /**
     * Event type (ENTER or EXIT)
     */
    event: EventType;

    /**
     * Thread/process identifier
     */
    thread: string;

    /**
     * Class or module name
     */
    class: string;

    /**
     * Method or function name
     */
    method: string;

    /**
     * Stringified arguments
     */
    args: string;

    /**
     * Duration in microseconds (EXIT events only)
     */
    durationMicros?: number;

    /**
     * Duration in milliseconds (EXIT events only)
     */
    durationMillis?: number;

    /**
     * Stringified return value (EXIT events only)
     */
    result?: string;

    /**
     * Exception information (EXIT events with errors only)
     */
    exception?: {
      type: string;
      message: string;
      stack?: string;
    };
  }

  /**
   * Performance metrics from dashboard
   */
  export interface PerformanceMetrics {
    /**
     * Total number of method calls
     */
    totalCalls: number;

    /**
     * Average duration across all calls (ms)
     */
    avgDuration: number;

    /**
     * Total unique methods analyzed
     */
    totalMethods: number;

    /**
     * Number of exceptions thrown
     */
    exceptionCount: number;

    /**
     * Error rate percentage
     */
    errorRate: number;

    /**
     * Slowest methods
     */
    slowMethods: MethodMetric[];

    /**
     * Performance bottlenecks
     */
    bottlenecks: BottleneckMetric[];

    /**
     * Error hotspots
     */
    errorHotspots: ErrorMetric[];
  }

  /**
   * Method performance metric
   */
  export interface MethodMetric {
    /**
     * Method identifier (class.method)
     */
    method: string;

    /**
     * Number of calls
     */
    callCount: number;

    /**
     * Average duration (ms)
     */
    avgDuration: number;

    /**
     * Total time spent (ms)
     */
    totalTime: number;

    /**
     * P50 percentile (ms)
     */
    p50: number;

    /**
     * P95 percentile (ms)
     */
    p95: number;

    /**
     * P99 percentile (ms)
     */
    p99: number;
  }

  /**
   * Bottleneck metric (high impact methods)
   */
  export interface BottleneckMetric {
    /**
     * Method identifier
     */
    method: string;

    /**
     * Impact score (callCount × avgDuration)
     */
    impactScore: number;

    /**
     * Number of calls
     */
    callCount: number;

    /**
     * Average duration (ms)
     */
    avgDuration: number;
  }

  /**
   * Error hotspot metric
   */
  export interface ErrorMetric {
    /**
     * Method identifier
     */
    method: string;

    /**
     * Total calls (including successful)
     */
    callCount: number;

    /**
     * Number of exceptions
     */
    exceptionCount: number;

    /**
     * Error rate percentage
     */
    errorRate: number;

    /**
     * Most common exception type
     */
    exceptionType: string;
  }

  /**
   * Default FlowTrace agent instance
   */
  const agent: FlowTraceAgent;
  export default agent;

  /**
   * Re-export configuration types
   */
  export * from './config';
  export * from './logger';
  export * from './decorators';
}

declare module 'flowtrace-agent-js/loader' {
  /**
   * Node.js loader for CommonJS require() hook
   * Use with: node --require flowtrace-agent-js/loader app.js
   */
  export {};
}

declare module 'flowtrace-agent-js/esm-loader' {
  /**
   * Node.js ESM loader hook
   * Use with: node --loader flowtrace-agent-js/esm-loader app.mjs
   */
  export {};
}
