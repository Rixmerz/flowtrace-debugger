/**
 * Configuration management for FlowTrace Agent
 * Reads from environment variables and process arguments (identical to Java version)
 */

class FlowTraceConfig {
  constructor() {
    // Read configuration from environment variables and system properties
    this.packagePrefix = this._getConfig('flowtrace.package-prefix', 'FLOWTRACE_PACKAGE_PREFIX', '');
    this.logFile = this._getConfig('flowtrace.logfile', 'FLOWTRACE_LOGFILE', 'flowtrace.jsonl');
    this.stdout = this._parseBoolean(this._getConfig('flowtrace.stdout', 'FLOWTRACE_STDOUT', 'false'));
    this.annotationOnly = this._parseBoolean(this._getConfig('flowtrace.annotation-only', 'FLOWTRACE_ANNOTATION_ONLY', 'false'));
    this.enabled = this._parseBoolean(this._getConfig('flowtrace.enabled', 'FLOWTRACE_ENABLED', 'true'));

    // Additional JavaScript-specific configurations
    this.maxArgLength = parseInt(this._getConfig('flowtrace.max-arg-length', 'FLOWTRACE_MAX_ARG_LENGTH', '1000'));
    this.captureStackTrace = this._parseBoolean(this._getConfig('flowtrace.capture-stack', 'FLOWTRACE_CAPTURE_STACK', 'false'));
    this.asyncHooks = this._parseBoolean(this._getConfig('flowtrace.async-hooks', 'FLOWTRACE_ASYNC_HOOKS', 'true'));

    // Log segmentation configurations
    this.truncateThreshold = parseInt(this._getConfig('flowtrace.truncate-threshold', 'FLOWTRACE_TRUNCATE_THRESHOLD', '1000'));
    this.segmentDirectory = this._getConfig('flowtrace.segment-directory', 'FLOWTRACE_SEGMENT_DIRECTORY', 'flowtrace-jsonsl');
    this.enableSegmentation = this._parseBoolean(this._getConfig('flowtrace.enable-segmentation', 'FLOWTRACE_ENABLE_SEGMENTATION', 'true'));
  }

  /**
   * Get configuration value with priority:
   * 1. System property (--flowtrace.key=value)
   * 2. Environment variable
   * 3. Default value
   */
  _getConfig(sysProp, envVar, defaultValue) {
    // Check system property in process.execArgv or process.argv
    const sysPropPrefix = `-D${sysProp}=`;
    const allArgs = [...process.execArgv, ...process.argv];

    for (const arg of allArgs) {
      if (arg.startsWith(sysPropPrefix)) {
        return arg.substring(sysPropPrefix.length);
      }
    }

    // Check environment variable
    if (process.env[envVar] !== undefined) {
      return process.env[envVar];
    }

    // Return default
    return defaultValue;
  }

  /**
   * Parse boolean value (accepts: true/false, yes/no, 1/0, on/off)
   */
  _parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase().trim();
    return ['true', 'yes', '1', 'on'].includes(normalized);
  }

  /**
   * Check if a module path should be instrumented based on package prefix
   */
  shouldInstrument(modulePath) {
    if (!this.enabled) return false;
    if (!modulePath) return false;

    // Never instrument node_modules
    if (modulePath.includes('node_modules')) return false;

    // Never instrument Node.js built-in modules
    if (!modulePath.includes('/') && !modulePath.includes('\\')) return false;

    // If no package prefix specified, instrument everything in project (but not node_modules)
    if (!this.packagePrefix) return true;

    // Check if module path matches package prefix
    // Convert package prefix to path pattern (e.g., 'api.composer.flight' -> 'api/composer/flight')
    const pathPattern = this.packagePrefix.replace(/\./g, '/');

    // Check if path contains the pattern or hyphenated version (for package names like 'api-composer-flight')
    return modulePath.includes(pathPattern) ||
           modulePath.includes(this.packagePrefix.replace(/\./g, '-'));
  }

  /**
   * Get configuration as object (for debugging/logging)
   */
  toObject() {
    return {
      packagePrefix: this.packagePrefix,
      logFile: this.logFile,
      stdout: this.stdout,
      annotationOnly: this.annotationOnly,
      enabled: this.enabled,
      maxArgLength: this.maxArgLength,
      captureStackTrace: this.captureStackTrace,
      asyncHooks: this.asyncHooks,
      truncateThreshold: this.truncateThreshold,
      segmentDirectory: this.segmentDirectory,
      enableSegmentation: this.enableSegmentation
    };
  }

  /**
   * Print configuration (similar to Java version startup output)
   */
  print() {
    console.error('FlowTrace Agent Configuration:');
    console.error(`  Package Prefix:     ${this.packagePrefix || '(none - all packages)'}`);
    console.error(`  Log File:           ${this.logFile}`);
    console.error(`  Console Output:     ${this.stdout}`);
    console.error(`  Annotation Only:    ${this.annotationOnly}`);
    console.error(`  Enabled:            ${this.enabled}`);
    console.error(`  Max Arg Length:     ${this.maxArgLength}`);
    console.error(`  Capture Stack:      ${this.captureStackTrace}`);
    console.error(`  Async Hooks:        ${this.asyncHooks}`);
    console.error(`  Truncate Threshold: ${this.truncateThreshold}`);
    console.error(`  Segment Directory:  ${this.segmentDirectory}`);
    console.error(`  Enable Segmentation: ${this.enableSegmentation}`);
    console.error('');
  }
}

// Export singleton instance
const config = new FlowTraceConfig();
module.exports = config;
