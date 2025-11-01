/**
 * FlowTrace Browser Agent - Client-Side Execution Tracing
 *
 * Provides execution tracing for browser JavaScript through console interception
 * and automatic function instrumentation.
 *
 * Usage:
 *   <script src="flowtrace-browser-shim.js"></script>
 *   <script>
 *     FlowTrace.init({ packagePrefix: 'src/', captureStackTraces: true });
 *   </script>
 *
 * Features:
 * - Console method interception (log, error, warn, info, debug)
 * - Stack trace capture for execution context
 * - JSONL log format compatible with Node.js agent
 * - Export logs as downloadable JSONL file
 * - Memory-efficient circular buffer storage
 */

(function() {
  'use strict';

  // Default configuration
  const DEFAULT_CONFIG = {
    packagePrefix: '',           // Filter logs by source file prefix (e.g., 'src/')
    captureStackTraces: true,    // Capture stack traces for context
    maxLogEntries: 10000,        // Max entries before circular buffer overwrites
    consolePassthrough: true,    // Still show logs in console
    captureConsole: true,        // Intercept console methods
    timestampFormat: 'iso',      // 'iso' or 'epoch'
    enabled: true                // Master on/off switch
  };

  // Storage for log entries
  let logEntries = [];
  let config = { ...DEFAULT_CONFIG };
  let originalConsole = {};
  let isInitialized = false;

  /**
   * Initialize FlowTrace browser agent
   * @param {Object} options - Configuration options
   */
  function init(options = {}) {
    if (isInitialized) {
      console.warn('FlowTrace: Already initialized');
      return;
    }

    config = { ...DEFAULT_CONFIG, ...options };

    if (!config.enabled) {
      return;
    }

    // Store original console methods
    originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console)
    };

    if (config.captureConsole) {
      interceptConsole();
    }

    isInitialized = true;

    logInternalEvent('INIT', 'FlowTrace browser agent initialized', {
      config: {
        packagePrefix: config.packagePrefix,
        maxLogEntries: config.maxLogEntries,
        captureStackTraces: config.captureStackTraces
      }
    });
  }

  /**
   * Intercept console methods to capture logs
   */
  function interceptConsole() {
    const methods = ['log', 'error', 'warn', 'info', 'debug'];

    methods.forEach(method => {
      console[method] = function(...args) {
        // Capture the log entry
        captureConsoleLog(method.toUpperCase(), args);

        // Pass through to original console if enabled
        if (config.consolePassthrough) {
          originalConsole[method](...args);
        }
      };
    });
  }

  /**
   * Capture a console log entry
   * @param {String} level - Log level (LOG, ERROR, WARN, INFO, DEBUG)
   * @param {Array} args - Console arguments
   */
  function captureConsoleLog(level, args) {
    if (!config.enabled) return;

    const stackTrace = config.captureStackTraces ? getStackTrace() : null;
    const sourceLocation = stackTrace ? parseStackForSource(stackTrace) : null;

    // Filter by package prefix if configured
    if (config.packagePrefix && sourceLocation) {
      if (!sourceLocation.file.includes(config.packagePrefix)) {
        return; // Skip logs not matching package prefix
      }
    }

    const logEntry = {
      timestamp: config.timestampFormat === 'iso' ? new Date().toISOString() : Date.now(),
      event: 'CONSOLE',
      level: level,
      thread: 'main',
      message: formatConsoleArgs(args),
      source: sourceLocation,
      stackTrace: config.captureStackTraces ? stackTrace : undefined
    };

    addLogEntry(logEntry);
  }

  /**
   * Format console arguments as string
   * @param {Array} args - Console arguments
   * @returns {String} Formatted message
   */
  function formatConsoleArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  /**
   * Get current stack trace
   * @returns {String} Stack trace
   */
  function getStackTrace() {
    const stack = new Error().stack;
    if (!stack) return '';

    // Remove the first 3 lines (Error message + getStackTrace + captureConsoleLog)
    const lines = stack.split('\n');
    return lines.slice(3).join('\n');
  }

  /**
   * Parse stack trace to extract source location
   * @param {String} stack - Stack trace string
   * @returns {Object|null} Source location {file, line, column}
   */
  function parseStackForSource(stack) {
    if (!stack) return null;

    const lines = stack.split('\n');
    if (lines.length === 0) return null;

    // Try to parse first relevant line
    const firstLine = lines[0];

    // Chrome/Edge format: "    at functionName (file:line:column)"
    let match = firstLine.match(/at\s+(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?/);

    // Firefox format: "functionName@file:line:column"
    if (!match) {
      match = firstLine.match(/^(?:.*?@)?(.+?):(\d+):(\d+)$/);
    }

    if (match) {
      return {
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      };
    }

    return null;
  }

  /**
   * Add log entry to storage (circular buffer)
   * @param {Object} entry - Log entry object
   */
  function addLogEntry(entry) {
    if (logEntries.length >= config.maxLogEntries) {
      // Circular buffer: remove oldest entry
      logEntries.shift();
    }
    logEntries.push(entry);
  }

  /**
   * Log internal FlowTrace event
   * @param {String} event - Event type
   * @param {String} message - Event message
   * @param {Object} data - Additional data
   */
  function logInternalEvent(event, message, data = {}) {
    const logEntry = {
      timestamp: config.timestampFormat === 'iso' ? new Date().toISOString() : Date.now(),
      event: event,
      thread: 'main',
      message: message,
      ...data
    };
    addLogEntry(logEntry);
  }

  /**
   * Export logs as JSONL file download
   * @param {String} filename - Optional filename (default: flowtrace-browser.jsonl)
   */
  function exportLogs(filename = 'flowtrace-browser.jsonl') {
    if (logEntries.length === 0) {
      originalConsole.warn('FlowTrace: No log entries to export');
      return;
    }

    // Convert to JSONL format (one JSON object per line)
    const jsonlContent = logEntries.map(entry => JSON.stringify(entry)).join('\n');

    // Create blob and download
    const blob = new Blob([jsonlContent], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    originalConsole.log(`FlowTrace: Exported ${logEntries.length} log entries to ${filename}`);
  }

  /**
   * Get current log entries
   * @returns {Array} Log entries
   */
  function getLogs() {
    return [...logEntries];
  }

  /**
   * Clear all log entries
   */
  function clearLogs() {
    const count = logEntries.length;
    logEntries = [];
    logInternalEvent('CLEAR', `Cleared ${count} log entries`);
  }

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  function getConfig() {
    return { ...config };
  }

  /**
   * Update configuration
   * @param {Object} newConfig - Configuration updates
   */
  function updateConfig(newConfig) {
    config = { ...config, ...newConfig };
    logInternalEvent('CONFIG_UPDATE', 'Configuration updated', { config: newConfig });
  }

  /**
   * Disable FlowTrace
   */
  function disable() {
    config.enabled = false;
    logInternalEvent('DISABLE', 'FlowTrace disabled');
  }

  /**
   * Enable FlowTrace
   */
  function enable() {
    config.enabled = true;
    logInternalEvent('ENABLE', 'FlowTrace enabled');
  }

  /**
   * Get statistics about captured logs
   * @returns {Object} Statistics
   */
  function getStats() {
    const stats = {
      totalEntries: logEntries.length,
      maxCapacity: config.maxLogEntries,
      utilizationPercent: (logEntries.length / config.maxLogEntries * 100).toFixed(2),
      byLevel: {},
      byEvent: {}
    };

    logEntries.forEach(entry => {
      if (entry.level) {
        stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
      }
      stats.byEvent[entry.event] = (stats.byEvent[entry.event] || 0) + 1;
    });

    return stats;
  }

  // Expose FlowTrace API to window
  window.FlowTrace = {
    init,
    export: exportLogs,
    getLogs,
    clearLogs,
    getConfig,
    updateConfig,
    disable,
    enable,
    getStats,
    version: '1.0.0'
  };

  // Auto-initialize if data-auto-init attribute is present
  if (document.currentScript && document.currentScript.hasAttribute('data-auto-init')) {
    const autoConfig = {};
    const scriptAttrs = document.currentScript.attributes;

    if (scriptAttrs['data-package-prefix']) {
      autoConfig.packagePrefix = scriptAttrs['data-package-prefix'].value;
    }
    if (scriptAttrs['data-max-entries']) {
      autoConfig.maxLogEntries = parseInt(scriptAttrs['data-max-entries'].value, 10);
    }
    if (scriptAttrs['data-capture-stack']) {
      autoConfig.captureStackTraces = scriptAttrs['data-capture-stack'].value === 'true';
    }

    init(autoConfig);
  }

})();
