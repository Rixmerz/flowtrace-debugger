/**
 * FlowTrace Configuration Types
 *
 * Configuration can be provided via:
 * - Environment variables (FLOWTRACE_*)
 * - Java-style system properties (-Dflowtrace.*)
 * - Configuration object passed to init()
 */

declare module 'flowtrace-agent-js/config' {
  /**
   * FlowTrace configuration options
   */
  export interface FlowTraceConfig {
    /**
     * Package prefix to filter instrumentation
     *
     * Only classes/modules matching this prefix will be traced.
     * Use empty string to trace everything (WARNING: high overhead)
     *
     * Examples:
     * - "app" - traces app/**
     * - "src/controllers" - traces src/controllers/**
     * - "com.example.app" - traces com.example.app.**
     *
     * Environment: FLOWTRACE_PACKAGE_PREFIX
     * System property: flowtrace.package-prefix
     *
     * @default ""
     */
    packagePrefix?: string;

    /**
     * Log file path (JSONL format)
     *
     * Environment: FLOWTRACE_LOG_FILE / FLOWTRACE_LOGFILE
     * System property: flowtrace.logfile
     *
     * @default "flowtrace.jsonl"
     */
    logFile?: string;

    /**
     * Also output logs to stdout
     *
     * Environment: FLOWTRACE_STDOUT
     * System property: flowtrace.stdout
     *
     * @default false
     */
    stdout?: boolean;

    /**
     * Maximum argument/result string length
     *
     * Set to 0 for no truncation.
     * Large values may impact performance and log size.
     *
     * Environment: FLOWTRACE_MAX_ARG_LENGTH
     * System property: flowtrace.max-arg-length
     *
     * @default 1000
     */
    maxArgLength?: number;

    /**
     * Capture stack traces on function entry
     *
     * Useful for debugging but adds overhead.
     *
     * Environment: FLOWTRACE_CAPTURE_STACK
     * System property: flowtrace.capture-stack
     *
     * @default false
     */
    captureStackTrace?: boolean;

    /**
     * Enable async_hooks for async operation tracking
     *
     * Tracks async operations across async/await, promises, callbacks.
     * Adds some performance overhead.
     *
     * Environment: FLOWTRACE_ASYNC_HOOKS
     * System property: flowtrace.async-hooks
     *
     * @default true
     */
    asyncHooks?: boolean;

    /**
     * Exclude specific patterns from instrumentation
     *
     * Regular expressions to exclude files/modules.
     *
     * @default [/node_modules/, /\.min\.js$/, ...]
     */
    excludePatterns?: RegExp[];

    /**
     * Custom logger for FlowTrace internal messages
     *
     * @default console
     */
    logger?: {
      info(...args: any[]): void;
      warn(...args: any[]): void;
      error(...args: any[]): void;
      debug(...args: any[]): void;
    };

    /**
     * Enable debug mode for troubleshooting
     *
     * Environment: FLOWTRACE_DEBUG
     *
     * @default false
     */
    debug?: boolean;
  }

  /**
   * Load configuration from environment and system properties
   */
  export function loadConfig(overrides?: Partial<FlowTraceConfig>): FlowTraceConfig;

  /**
   * Validate configuration
   * @throws {Error} if configuration is invalid
   */
  export function validateConfig(config: FlowTraceConfig): void;

  /**
   * Get configuration value with fallback chain:
   * 1. System property (-Dflowtrace.*)
   * 2. Environment variable (FLOWTRACE_*)
   * 3. Default value
   */
  export function getConfigValue(
    sysProp: string,
    envVar: string,
    defaultValue: string
  ): string;
}
