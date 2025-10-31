/**
 * Main Module Instrumentor
 * Instruments the entry point file by wrapping all function definitions
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const config = require('./config');
const exclusions = require('./exclusions');
const logger = require('./logger');
const { getThreadName } = require('./instrumentation');

/**
 * Instrument source code by wrapping function declarations
 */
function instrumentSource(source, filename) {
  const moduleName = path.basename(filename, path.extname(filename));

  // Inject instrumentation wrapper at the beginning
  const instrumentationCode = `
// FlowTrace instrumentation injected
const __flowtrace_logger = require(${JSON.stringify(path.join(__dirname, 'logger.js'))});
const __flowtrace_getTime = () => process.hrtime.bigint();
const __flowtrace_thread = ${JSON.stringify(`pid-${process.pid}`)};
const __flowtrace_moduleName = ${JSON.stringify(moduleName)};

// Wrapper function for instrumentation
function __flowtrace_wrap(fn, methodName) {
  if (!fn || typeof fn !== 'function') return fn;
  if (fn.__flowtraceWrapped) return fn;

  const wrapped = function(...args) {
    __flowtrace_logger.logEnter(__flowtrace_moduleName, methodName, args, __flowtrace_thread);
    const startTime = __flowtrace_getTime();

    try {
      const result = fn.apply(this, args);

      if (result && typeof result.then === 'function') {
        return result
          .then((resolvedValue) => {
            const endTime = __flowtrace_getTime();
            const durationNanos = endTime - startTime;
            __flowtrace_logger.logExit(__flowtrace_moduleName, methodName, args, resolvedValue, null, durationNanos, __flowtrace_thread);
            return resolvedValue;
          })
          .catch((error) => {
            const endTime = __flowtrace_getTime();
            const durationNanos = endTime - startTime;
            __flowtrace_logger.logExit(__flowtrace_moduleName, methodName, args, null, error, durationNanos, __flowtrace_thread);
            throw error;
          });
      }

      const endTime = __flowtrace_getTime();
      const durationNanos = endTime - startTime;
      __flowtrace_logger.logExit(__flowtrace_moduleName, methodName, args, result, null, durationNanos, __flowtrace_thread);
      return result;
    } catch (error) {
      const endTime = __flowtrace_getTime();
      const durationNanos = endTime - startTime;
      __flowtrace_logger.logExit(__flowtrace_moduleName, methodName, args, null, error, durationNanos, __flowtrace_thread);
      throw error;
    }
  };

  wrapped.__flowtraceWrapped = true;
  Object.defineProperty(wrapped, 'name', { value: fn.name || methodName, configurable: true });
  Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
  return wrapped;
}

// Wrap class methods
function __flowtrace_wrapClass(ClassConstructor, className) {
  if (!ClassConstructor || ClassConstructor.__flowtraceWrapped) return ClassConstructor;

  const WrappedClass = function(...args) {
    __flowtrace_logger.logEnter(className || ClassConstructor.name, 'constructor', args, __flowtrace_thread);
    const startTime = __flowtrace_getTime();

    try {
      const instance = new ClassConstructor(...args);
      const endTime = __flowtrace_getTime();
      const durationNanos = endTime - startTime;
      __flowtrace_logger.logExit(className || ClassConstructor.name, 'constructor', args, instance, null, durationNanos, __flowtrace_thread);

      // Wrap instance methods
      for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        if (key !== 'constructor' && typeof instance[key] === 'function') {
          instance[key] = __flowtrace_wrap(instance[key], key);
        }
      }

      return instance;
    } catch (error) {
      const endTime = __flowtrace_getTime();
      const durationNanos = endTime - startTime;
      __flowtrace_logger.logExit(className || ClassConstructor.name, 'constructor', args, null, error, durationNanos, __flowtrace_thread);
      throw error;
    }
  };

  WrappedClass.prototype = ClassConstructor.prototype;
  Object.setPrototypeOf(WrappedClass, ClassConstructor);
  WrappedClass.__flowtraceWrapped = true;
  return WrappedClass;
}
`;

  // Transform the source by wrapping function declarations and expressions
  // This is a simple regex-based approach - for production, use AST transformation
  let transformedSource = instrumentationCode + '\n' + source;

  // Wrap named function declarations: function name(...) { }
  transformedSource = transformedSource.replace(
    /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
    (match, funcName) => {
      if (funcName.startsWith('__flowtrace_')) return match;
      return `const ${funcName} = __flowtrace_wrap(function ${funcName}(`;
    }
  );

  // Wrap class declarations: class Name { }
  transformedSource = transformedSource.replace(
    /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    (match, className) => {
      return `const ${className} = __flowtrace_wrapClass(class ${className}`;
    }
  );

  return transformedSource;
}

/**
 * Create a custom Module._compile that instruments the source
 */
function createInstrumentingCompile(originalCompile, instrumentation) {
  return function(content, filename) {
    // Check if should instrument BEFORE compiling
    if (exclusions.shouldExclude(filename) ||
        (config.packagePrefix && !config.shouldInstrument(filename))) {
      // Don't instrument, just compile normally
      return originalCompile.call(this, content, filename);
    }

    // Compile normally for modules we want to instrument
    const result = originalCompile.call(this, content, filename);

    // Only instrument the main module
    if (this !== require.main) {
      return result;
    }

    console.error(`FlowTrace: Instrumenting main module exports: ${filename}`);

    try {
      // Instrument module.exports
      if (this.exports) {
        const moduleName = path.basename(filename, path.extname(filename));

        if (typeof this.exports === 'function') {
          // Single function export
          this.exports = instrumentation.wrapFunction(this.exports, moduleName, this.exports.name || 'default');
        } else if (typeof this.exports === 'object') {
          // Object with multiple exports
          for (const key in this.exports) {
            if (!this.exports.hasOwnProperty(key)) continue;
            if (exclusions.shouldExcludeProperty(key)) continue;

            const value = this.exports[key];

            if (typeof value === 'function') {
              this.exports[key] = instrumentation.wrapFunction(value, moduleName, key);
            } else if (value && value.constructor && value.constructor !== Object && typeof value === 'function') {
              this.exports[key] = instrumentation.wrapClass(value, moduleName);
            }
          }
        }

        console.error(`FlowTrace: Successfully instrumented ${Object.keys(this.exports).length} exports`);
      }
    } catch (error) {
      console.error(`FlowTrace: Error instrumenting ${filename}:`, error.message);
    }

    return result;
  };
}

module.exports = {
  instrumentSource,
  createInstrumentingCompile
};
