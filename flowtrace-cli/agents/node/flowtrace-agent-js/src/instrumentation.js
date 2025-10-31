/**
 * Function instrumentation for FlowTrace Agent
 * Wraps functions to capture entry/exit events with timing
 */

const logger = require('./logger');
const exclusions = require('./exclusions');
const config = require('./config');

/**
 * Get current thread/worker name
 */
function getThreadName() {
  if (typeof process.pid !== 'undefined') {
    return `pid-${process.pid}`;
  }
  return 'main';
}

/**
 * Get high-resolution time in nanoseconds
 */
function getTimeNanos() {
  const hrTime = process.hrtime.bigint();
  return hrTime;
}

/**
 * Wrap a single function with instrumentation
 */
function wrapFunction(originalFn, className, methodName) {
  // Don't wrap already wrapped functions
  if (originalFn.__flowtraceWrapped) {
    return originalFn;
  }

  const wrappedFn = function(...args) {
    const threadName = getThreadName();

    // Log ENTER event
    logger.logEnter(className, methodName, args, threadName);

    const startTime = getTimeNanos();

    try {
      // Call original function
      const result = originalFn.apply(this, args);

      // Handle promises and async functions
      if (result && typeof result.then === 'function') {
        return result
          .then((resolvedValue) => {
            const endTime = getTimeNanos();
            const durationNanos = endTime - startTime;
            logger.logExit(className, methodName, args, resolvedValue, null, durationNanos, threadName);
            return resolvedValue;
          })
          .catch((error) => {
            const endTime = getTimeNanos();
            const durationNanos = endTime - startTime;
            logger.logExit(className, methodName, args, null, error, durationNanos, threadName);
            throw error;
          });
      }

      // Synchronous success
      const endTime = getTimeNanos();
      const durationNanos = endTime - startTime;
      logger.logExit(className, methodName, args, result, null, durationNanos, threadName);

      return result;
    } catch (error) {
      // Synchronous error
      const endTime = getTimeNanos();
      const durationNanos = endTime - startTime;
      logger.logExit(className, methodName, args, null, error, durationNanos, threadName);
      throw error;
    }
  };

  // Mark as wrapped to prevent double-wrapping
  wrappedFn.__flowtraceWrapped = true;

  // Preserve function properties
  Object.defineProperty(wrappedFn, 'name', {
    value: originalFn.name || methodName,
    configurable: true
  });

  Object.defineProperty(wrappedFn, 'length', {
    value: originalFn.length,
    configurable: true
  });

  return wrappedFn;
}

/**
 * Wrap all functions in an object/module
 */
function wrapModule(moduleExports, modulePath) {
  if (!moduleExports || typeof moduleExports !== 'object') {
    return moduleExports;
  }

  // Already wrapped
  if (moduleExports.__flowtraceWrapped) {
    return moduleExports;
  }

  // Get class/module name from path
  const className = getClassNameFromPath(modulePath);

  // Wrap based on export type
  if (typeof moduleExports === 'function') {
    // Single function export
    return wrapFunction(moduleExports, className, moduleExports.name || 'default');
  }

  // Object with multiple exports
  const wrapped = {};

  for (const key in moduleExports) {
    if (!moduleExports.hasOwnProperty(key)) continue;

    // Skip excluded properties
    if (exclusions.shouldExcludeProperty(key)) {
      wrapped[key] = moduleExports[key];
      continue;
    }

    const value = moduleExports[key];

    // Check if it's a class (ES6 class syntax)
    if (typeof value === 'function') {
      // Detect if it's a class constructor
      const isClass = /^class\s/.test(value.toString()) || value.prototype?.constructor === value;

      if (isClass) {
        wrapped[key] = wrapClass(value, className);
      } else {
        wrapped[key] = wrapFunction(value, className, key);
      }
    }
    // Copy other values
    else {
      wrapped[key] = value;
    }
  }

  // Mark as wrapped
  wrapped.__flowtraceWrapped = true;

  return wrapped;
}

/**
 * Wrap a class and its methods
 */
function wrapClass(ClassConstructor, parentClassName) {
  if (ClassConstructor.__flowtraceWrapped) {
    return ClassConstructor;
  }

  const className = ClassConstructor.name || parentClassName;

  // Wrap constructor
  const WrappedClass = function(...args) {
    const threadName = getThreadName();
    logger.logEnter(className, 'constructor', args, threadName);

    const startTime = getTimeNanos();

    try {
      const instance = new ClassConstructor(...args);

      const endTime = getTimeNanos();
      const durationNanos = endTime - startTime;
      logger.logExit(className, 'constructor', args, instance, null, durationNanos, threadName);

      // Wrap instance methods
      wrapInstanceMethods(instance, className);

      return instance;
    } catch (error) {
      const endTime = getTimeNanos();
      const durationNanos = endTime - startTime;
      logger.logExit(className, 'constructor', args, null, error, durationNanos, threadName);
      throw error;
    }
  };

  // Preserve prototype and static methods
  WrappedClass.prototype = ClassConstructor.prototype;
  wrapPrototypeMethods(WrappedClass.prototype, className);

  // Copy static methods
  for (const key of Object.getOwnPropertyNames(ClassConstructor)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name') {
      const descriptor = Object.getOwnPropertyDescriptor(ClassConstructor, key);
      if (descriptor) {
        Object.defineProperty(WrappedClass, key, descriptor);
      }
    }
  }

  WrappedClass.__flowtraceWrapped = true;
  return WrappedClass;
}

/**
 * Wrap prototype methods
 */
function wrapPrototypeMethods(prototype, className) {
  const properties = Object.getOwnPropertyNames(prototype);

  for (const key of properties) {
    if (exclusions.shouldExcludeProperty(key)) continue;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    descriptor.value = wrapFunction(descriptor.value, className, key);
    Object.defineProperty(prototype, key, descriptor);
  }
}

/**
 * Wrap instance methods
 */
function wrapInstanceMethods(instance, className) {
  const properties = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));

  for (const key of properties) {
    if (exclusions.shouldExcludeProperty(key)) continue;
    if (typeof instance[key] !== 'function') continue;

    instance[key] = wrapFunction(instance[key], className, key);
  }
}

/**
 * Extract class name from module path
 */
function getClassNameFromPath(modulePath) {
  if (!modulePath) return 'UnknownModule';

  // Remove file extension
  let name = modulePath.replace(/\.(js|ts|mjs|cjs)$/, '');

  // Get filename without path
  name = name.split('/').pop() || name;
  name = name.split('\\').pop() || name;

  // Convert to PascalCase if needed
  if (name.includes('-') || name.includes('_')) {
    name = name
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  return name || 'UnknownModule';
}

module.exports = {
  wrapFunction,
  wrapModule,
  wrapClass,
  getThreadName,
  getTimeNanos
};
