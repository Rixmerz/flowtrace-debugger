/**
 * JSON Logger for FlowTrace Agent
 * Outputs identical JSON format to Java version
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

class FlowTraceLogger {
  constructor() {
    this.logStream = null;
    this.initialized = false;
    this.segmentDirCreated = false;
  }

  /**
   * Initialize logger with file stream
   */
  init() {
    if (this.initialized) return;

    try {
      if (config.logFile && config.logFile !== 'stdout') {
        // Open file stream for writing (append mode)
        this.logStream = fs.createWriteStream(config.logFile, {
          flags: 'a',
          encoding: 'utf8'
        });

        this.logStream.on('error', (err) => {
          console.error(`FlowTrace: Error writing to log file: ${err.message}`);
        });
      }

      this.initialized = true;
    } catch (err) {
      console.error(`FlowTrace: Failed to initialize logger: ${err.message}`);
    }
  }

  /**
   * Log ENTER event (method entry)
   * Format identical to Java version
   */
  logEnter(className, methodName, args, threadName = 'main') {
    if (!config.enabled) return;

    const event = {
      timestamp: Date.now(),
      event: 'ENTER',
      thread: threadName,
      class: className,
      method: methodName,
      args: this._serializeArgs(args)
    };

    this._writeLog(event);
  }

  /**
   * Log EXIT event (method exit)
   * Format identical to Java version
   */
  logExit(className, methodName, args, result, exception, durationNanos, threadName = 'main') {
    if (!config.enabled) return;

    const durationMicros = Math.floor(Number(durationNanos) / 1000);
    const durationMillis = Math.floor(durationMicros / 1000);

    const event = {
      timestamp: Date.now(),
      event: 'EXIT',
      thread: threadName,
      class: className,
      method: methodName,
      args: this._serializeArgs(args),
      durationMicros,
      durationMillis
    };

    // Add result or exception
    if (exception) {
      event.exception = this._serializeException(exception);
    } else if (result !== undefined) {
      event.result = this._serializeValue(result);
    }

    this._writeLog(event);
  }

  /**
   * Serialize function arguments
   */
  _serializeArgs(args) {
    if (!args || args.length === 0) return '[]';

    try {
      const serialized = Array.from(args).map(arg => this._serializeValue(arg));
      const json = JSON.stringify(serialized);

      // Truncate if too long (only if maxArgLength > 0)
      if (config.maxArgLength > 0 && json.length > config.maxArgLength) {
        return json.substring(0, config.maxArgLength) + '...]';
      }

      return json;
    } catch (err) {
      return '[<serialization-error>]';
    }
  }

  /**
   * Serialize a single value
   */
  _serializeValue(value) {
    if (value === null) return null;
    if (value === undefined) return '<undefined>';

    const type = typeof value;

    // Primitives
    if (type === 'string' || type === 'number' || type === 'boolean') {
      return value;
    }

    // Functions
    if (type === 'function') {
      return `<function ${value.name || 'anonymous'}>`;
    }

    // Promises
    if (value instanceof Promise) {
      return '<Promise>';
    }

    // Errors
    if (value instanceof Error) {
      return `<Error: ${value.message}>`;
    }

    // Arrays - serialize all items (no truncation)
    if (Array.isArray(value)) {
      return value.map(v => this._serializeValue(v));
    }

    // Objects
    if (type === 'object') {
      try {
        // Get constructor name
        const className = value.constructor ? value.constructor.name : 'Object';

        // For simple objects, serialize completely (no truncation)
        if (className === 'Object') {
          const keys = Object.keys(value);
          if (keys.length === 0) return '{}';

          // Try to serialize the full object
          try {
            return JSON.stringify(value);
          } catch (jsonErr) {
            // If JSON.stringify fails (circular refs), show keys
            return `{${keys.join(', ')}}`;
          }
        }

        // For class instances, try to serialize or show class name
        try {
          return JSON.stringify(value);
        } catch (jsonErr) {
          return `<${className}>`;
        }
      } catch (err) {
        return '<object>';
      }
    }

    return '<unknown>';
  }

  /**
   * Serialize exception/error
   * Format identical to Java version
   */
  _serializeException(error) {
    const exceptionData = {
      type: error.constructor ? error.constructor.name : 'Error',
      message: error.message || '<no message>'
    };

    // Add stack trace if configured
    if (config.captureStackTrace && error.stack) {
      exceptionData.stackTrace = error.stack;
    }

    return exceptionData;
  }

  /**
   * Ensure segment directory exists
   */
  _ensureSegmentDirectory() {
    if (this.segmentDirCreated) return;

    try {
      if (!fs.existsSync(config.segmentDirectory)) {
        fs.mkdirSync(config.segmentDirectory, { recursive: true });
      }
      this.segmentDirCreated = true;
    } catch (err) {
      console.error(`FlowTrace: Failed to create segment directory: ${err.message}`);
    }
  }

  /**
   * Write full log to separate file
   */
  _writeSegmentedLog(event, timestamp, eventType) {
    try {
      this._ensureSegmentDirectory();

      const filename = `flowtrace-${timestamp}-${eventType}.json`;
      const filepath = path.join(config.segmentDirectory, filename);

      fs.writeFileSync(filepath, JSON.stringify(event, null, 2), 'utf8');

      return filename;
    } catch (err) {
      console.error(`FlowTrace: Failed to write segmented log: ${err.message}`);
      return null;
    }
  }

  /**
   * Check if a specific field needs truncation
   * @param {Object} event - The log event
   * @param {string} field - The field name to check ('args' or 'result')
   * @returns {boolean} - True if field needs truncation
   */
  _shouldTruncateField(event, field) {
    if (!config.enableSegmentation) return false;
    if (!event[field]) return false;

    const fieldLength = typeof event[field] === 'string'
      ? event[field].length
      : JSON.stringify(event[field]).length;

    return fieldLength > config.truncateThreshold;
  }

  /**
   * Truncate a specific field and return the truncated data
   * @param {Object} event - The log event
   * @param {string} field - The field to truncate
   * @returns {Object} - Object with truncated field value and metadata
   */
  _truncateField(event, field) {
    const fieldStr = typeof event[field] === 'string'
      ? event[field]
      : JSON.stringify(event[field]);

    return {
      truncated: fieldStr.substring(0, config.truncateThreshold) + '...(truncated)',
      originalLength: fieldStr.length
    };
  }

  /**
   * Write log entry (to file and/or stdout)
   */
  _writeLog(event) {
    let eventToWrite = event;
    const fieldsToCheck = ['args', 'result'];
    const truncatedFields = [];

    // Check all fields that might need truncation
    for (const field of fieldsToCheck) {
      if (this._shouldTruncateField(event, field)) {
        truncatedFields.push(field);
      }
    }

    // If any field needs truncation, handle segmentation
    if (truncatedFields.length > 0) {
      // Create a copy of the event with full data for segmented file
      const fullEvent = { ...event };

      // Write full log to separate file
      const filename = this._writeSegmentedLog(
        fullEvent,
        event.timestamp,
        event.event
      );

      if (filename) {
        // Create truncated version for main log
        eventToWrite = { ...event };

        // Truncate all fields that exceed threshold
        for (const field of truncatedFields) {
          const { truncated, originalLength } = this._truncateField(event, field);
          eventToWrite[field] = truncated;

          // Add metadata about truncation
          if (!eventToWrite.truncatedFields) {
            eventToWrite.truncatedFields = {};
          }
          eventToWrite.truncatedFields[field] = {
            originalLength,
            threshold: config.truncateThreshold
          };
        }

        eventToWrite.fullLogFile = `${config.segmentDirectory}/${filename}`;
      }
    }

    const line = JSON.stringify(eventToWrite) + '\n';

    // Write to file
    if (this.logStream) {
      this.logStream.write(line);
    }

    // Write to stdout if configured
    if (config.stdout) {
      process.stdout.write(line);
    }
  }

  /**
   * Flush and close logger
   */
  close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
    this.initialized = false;
  }
}

// Export singleton instance
const logger = new FlowTraceLogger();

// Initialize on module load
logger.init();

// Close logger on process exit
process.on('exit', () => logger.close());
process.on('SIGINT', () => {
  logger.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.close();
  process.exit(0);
});

module.exports = logger;
