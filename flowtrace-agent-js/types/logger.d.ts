/**
 * FlowTrace Logger Types
 *
 * Handles JSONL log output and performance tracking
 */

declare module 'flowtrace-agent-js/logger' {
  import { LogEntry, EventType } from 'flowtrace-agent-js';

  /**
   * FlowTrace logger interface
   */
  export interface FlowTraceLogger {
    /**
     * Log function entry
     */
    logEnter(context: LogContext): void;

    /**
     * Log function exit
     */
    logExit(context: LogContext, result?: any, error?: Error): void;

    /**
     * Write raw log entry
     */
    writeLog(entry: LogEntry): void;

    /**
     * Flush logs to file
     */
    flush(): Promise<void>;

    /**
     * Close logger and cleanup resources
     */
    close(): void;

    /**
     * Get current log file path
     */
    getLogFilePath(): string;

    /**
     * Get log statistics
     */
    getStats(): LogStats;
  }

  /**
   * Context for logging function calls
   */
  export interface LogContext {
    /**
     * Class or module name
     */
    className: string;

    /**
     * Method or function name
     */
    methodName: string;

    /**
     * Function arguments
     */
    args: any[];

    /**
     * Entry timestamp (for duration calculation)
     */
    startTime?: number;

    /**
     * Thread/process identifier
     */
    thread?: string;

    /**
     * Stack trace (if captureStackTrace is enabled)
     */
    stackTrace?: string;
  }

  /**
   * Log statistics
   */
  export interface LogStats {
    /**
     * Total log entries written
     */
    totalEntries: number;

    /**
     * Total ENTER events
     */
    enterEvents: number;

    /**
     * Total EXIT events
     */
    exitEvents: number;

    /**
     * Total exceptions logged
     */
    exceptionCount: number;

    /**
     * Log file size in bytes
     */
    fileSize: number;

    /**
     * Log file path
     */
    filePath: string;

    /**
     * Logging started timestamp
     */
    startedAt: number;

    /**
     * Last log entry timestamp
     */
    lastLogAt?: number;
  }

  /**
   * Serialize value for logging
   * Handles circular references and complex types
   */
  export function serializeValue(value: any, maxLength?: number): string;

  /**
   * Format exception for logging
   */
  export function formatException(error: Error): {
    type: string;
    message: string;
    stack?: string;
  };

  /**
   * Calculate duration between timestamps
   */
  export function calculateDuration(startTime: number, endTime: number): {
    micros: number;
    millis: number;
  };

  /**
   * Get current thread identifier
   */
  export function getThreadId(): string;

  /**
   * Create a new FlowTrace logger instance
   */
  export function createLogger(logFilePath: string, options?: {
    stdout?: boolean;
    maxArgLength?: number;
  }): FlowTraceLogger;

  /**
   * Default logger instance
   */
  export const logger: FlowTraceLogger;
}
