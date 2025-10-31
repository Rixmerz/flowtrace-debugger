/**
 * Module exclusion rules for FlowTrace Agent
 * Equivalent to Java version's exclusions (JDK, Spring, logging libraries, etc.)
 */

const path = require('path');
const config = require('./config');

/**
 * Patterns for modules that should NOT be instrumented
 * Equivalent to Java's exclusions
 */
const EXCLUSION_PATTERNS = [
  // Node.js core modules
  /^(node:)?internal\//,
  /^(node:)?(assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)/,

  // Node.js built-in libraries
  /^_http_/,
  /^_stream_/,
  /^_tls_/,

  // NPM and package management
  /node_modules\/npm\//,
  /node_modules\/yarn\//,
  /node_modules\/pnpm\//,

  // Common logging libraries (equivalent to log4j, slf4j exclusions)
  /node_modules\/(winston|bunyan|pino|morgan|debug|log4js|signale|consola)\//,

  // Testing frameworks (equivalent to JUnit exclusions)
  /node_modules\/(jest|mocha|jasmine|chai|ava|tape|vitest|playwright)\//,
  /__tests__\//,
  /\.test\.(js|ts|mjs|cjs)$/,
  /\.spec\.(js|ts|mjs|cjs)$/,

  // Build tools and bundlers
  /node_modules\/(webpack|rollup|vite|esbuild|parcel|browserify)\//,
  /node_modules\/(babel|@babel)\//,
  /node_modules\/(typescript|ts-node|@types)\//,

  // Common frameworks (equivalent to Spring exclusions)
  /node_modules\/(express|koa|fastify|hapi|restify)\/lib\/(router|application|request|response)\.(js|ts)$/,

  // Database drivers and ORMs
  /node_modules\/(pg|mysql|mysql2|mongodb|redis|ioredis|sequelize|typeorm|prisma|knex)\//,

  // Utility libraries (high-volume, low-value instrumentation)
  /node_modules\/(lodash|underscore|ramda|moment|date-fns|axios|got|node-fetch)\//,

  // Promise and async utilities
  /node_modules\/(bluebird|q|when|async|co)\//,

  // React and frontend frameworks (if running SSR)
  /node_modules\/(react|react-dom|vue|angular|svelte)\/dist\//,

  // FlowTrace agent itself (prevent recursion)
  /flowtrace-agent-js\//,
];

/**
 * Additional exclusions for specific file types
 */
const FILE_EXTENSION_EXCLUSIONS = [
  '.json',
  '.map',
  '.min.js',
  '.bundle.js',
  '.config.js',
  '.d.ts',
];

/**
 * Path-based exclusions
 */
const PATH_EXCLUSIONS = [
  'node_modules/.bin/',
  'node_modules/.cache/',
  'dist/',
  'build/',
  'coverage/',
  '.git/',
  '.vscode/',
  '.idea/',
];

class ExclusionManager {
  constructor() {
    this.exclusionPatterns = EXCLUSION_PATTERNS;
    this.fileExtensionExclusions = FILE_EXTENSION_EXCLUSIONS;
    this.pathExclusions = PATH_EXCLUSIONS;

    // Custom exclusions from environment
    const customExclusions = process.env.FLOWTRACE_EXCLUDE;
    if (customExclusions) {
      const patterns = customExclusions.split(',').map(p => new RegExp(p.trim()));
      this.exclusionPatterns.push(...patterns);
    }
  }

  /**
   * Check if a module should be excluded from instrumentation
   */
  shouldExclude(modulePath) {
    if (!modulePath) return true;

    // Normalize path
    const normalized = path.normalize(modulePath);

    // Check file extension exclusions
    for (const ext of this.fileExtensionExclusions) {
      if (normalized.endsWith(ext)) return true;
    }

    // Check path exclusions
    for (const pathExcl of this.pathExclusions) {
      if (normalized.includes(pathExcl)) return true;
    }

    // Check pattern exclusions
    for (const pattern of this.exclusionPatterns) {
      if (pattern.test(normalized)) return true;
    }

    // Check package prefix filter
    if (config.packagePrefix && !config.shouldInstrument(normalized)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a specific property/function should be excluded
   */
  shouldExcludeProperty(propertyName) {
    // Exclude private properties (start with _)
    if (propertyName.startsWith('_')) return true;

    // Exclude constructor
    if (propertyName === 'constructor') return true;

    // Exclude common prototype methods
    const prototypeExclusions = [
      'toString',
      'valueOf',
      'toJSON',
      'inspect',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable'
    ];

    return prototypeExclusions.includes(propertyName);
  }

  /**
   * Get summary of exclusion rules
   */
  getSummary() {
    return {
      exclusionPatterns: this.exclusionPatterns.length,
      fileExtensions: this.fileExtensionExclusions.length,
      pathExclusions: this.pathExclusions.length,
      packagePrefix: config.packagePrefix || '(none)'
    };
  }
}

// Export singleton instance
const exclusionManager = new ExclusionManager();
module.exports = exclusionManager;
