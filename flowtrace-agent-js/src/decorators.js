/**
 * FlowTrace TypeScript Decorators
 *
 * Ergonomic decorators for TypeScript classes and methods
 * Requires experimentalDecorators: true in tsconfig.json
 *
 * @author Juan Pablo Diaz <juanpablo516@gmail.com>
 * @license MIT
 */

const logger = require('./logger');

// Metadata symbol for decorator configuration
const FLOWTRACE_METADATA = Symbol.for('flowtrace:metadata');

/**
 * Store decorator metadata on target
 */
function setMetadata(target, propertyKey, metadata) {
  if (!target[FLOWTRACE_METADATA]) {
    target[FLOWTRACE_METADATA] = new Map();
  }
  const key = propertyKey || '__class__';
  target[FLOWTRACE_METADATA].set(key, metadata);
}

/**
 * Get decorator metadata from target
 */
function getMetadata(target, propertyKey) {
  if (!target || !target[FLOWTRACE_METADATA]) {
    return undefined;
  }
  const key = propertyKey || '__class__';
  return target[FLOWTRACE_METADATA].get(key);
}

/**
 * Default decorator options
 */
const DEFAULT_OPTIONS = {
  captureArgs: true,
  captureResult: true,
  captureExceptions: true,
  excludeArgs: [],
};

/**
 * Wrap a method with tracing logic
 */
function wrapMethod(originalMethod, className, methodName, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return function (...args) {
    const context = {
      className: opts.className || className,
      methodName: opts.methodName || methodName,
      args: opts.captureArgs ? filterArgs(args, opts.excludeArgs) : [],
      startTime: Date.now(),
    };

    logger.logEnter(context);

    try {
      const result = originalMethod.apply(this, args);

      // Handle async/Promise-returning methods
      if (result && typeof result.then === 'function') {
        return result
          .then((value) => {
            if (opts.captureResult) {
              logger.logExit(context, value);
            } else {
              logger.logExit(context);
            }
            return value;
          })
          .catch((error) => {
            if (opts.captureExceptions) {
              logger.logExit(context, undefined, error);
            }
            throw error;
          });
      }

      // Synchronous method
      if (opts.captureResult) {
        logger.logExit(context, result);
      } else {
        logger.logExit(context);
      }

      return result;
    } catch (error) {
      if (opts.captureExceptions) {
        logger.logExit(context, undefined, error);
      }
      throw error;
    }
  };
}

/**
 * Filter arguments based on exclude list
 */
function filterArgs(args, excludeIndices) {
  if (!excludeIndices || excludeIndices.length === 0) {
    return args;
  }

  return args.map((arg, index) => {
    if (excludeIndices.includes(index)) {
      return '[EXCLUDED]';
    }
    return arg;
  });
}

/**
 * @Trace() decorator for methods
 *
 * Usage:
 *   @Trace()
 *   async getUser(id: string): Promise<User> { ... }
 *
 *   @Trace({ captureArgs: false })
 *   login(email: string, password: string) { ... }
 */
function Trace(options = {}) {
  return function (target, propertyKey, descriptor) {
    if (!descriptor) {
      throw new Error('@Trace() can only be applied to methods');
    }

    const className = target.constructor?.name || 'Unknown';
    const methodName = String(propertyKey);
    const originalMethod = descriptor.value;

    if (typeof originalMethod !== 'function') {
      throw new Error(`@Trace() can only be applied to methods, not to ${typeof originalMethod}`);
    }

    // Store metadata
    setMetadata(target, propertyKey, { ...DEFAULT_OPTIONS, ...options });

    // Replace method with wrapped version
    descriptor.value = wrapMethod(originalMethod, className, methodName, options);

    return descriptor;
  };
}

/**
 * @TraceClass() decorator for classes
 *
 * Automatically traces all methods in a class
 *
 * Usage:
 *   @TraceClass()
 *   class UserService { ... }
 */
function TraceClass(options = {}) {
  return function (constructor) {
    const className = constructor.name;

    // Store class-level metadata
    setMetadata(constructor.prototype, null, { ...DEFAULT_OPTIONS, ...options });

    // Get all method names
    const methodNames = Object.getOwnPropertyNames(constructor.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof constructor.prototype[name] === 'function'
    );

    // Wrap each method
    methodNames.forEach((methodName) => {
      const originalMethod = constructor.prototype[methodName];
      const wrappedMethod = wrapMethod(originalMethod, className, methodName, options);
      constructor.prototype[methodName] = wrappedMethod;

      // Store metadata for this method
      setMetadata(constructor.prototype, methodName, { ...DEFAULT_OPTIONS, ...options });
    });

    return constructor;
  };
}

/**
 * @ExcludeFromTrace property decorator
 *
 * Mark property to exclude from logs
 */
function ExcludeFromTrace(target, propertyKey) {
  // Mark property as excluded in metadata
  const metadata = getMetadata(target, propertyKey) || {};
  metadata.excluded = true;
  setMetadata(target, propertyKey, metadata);

  // Override property descriptor to prevent serialization
  let value;
  Object.defineProperty(target, propertyKey, {
    get() {
      return value;
    },
    set(newValue) {
      value = newValue;
    },
    enumerable: false, // Don't show in Object.keys() or JSON.stringify()
    configurable: true,
  });
}

/**
 * @ExcludeParam parameter decorator
 *
 * Exclude specific parameter from logging
 */
function ExcludeParam(target, propertyKey, parameterIndex) {
  const metadata = getMetadata(target, propertyKey) || { ...DEFAULT_OPTIONS };

  if (!metadata.excludeArgs) {
    metadata.excludeArgs = [];
  }

  if (!metadata.excludeArgs.includes(parameterIndex)) {
    metadata.excludeArgs.push(parameterIndex);
  }

  setMetadata(target, propertyKey, metadata);
}

/**
 * @TraceAsync() decorator for async methods
 *
 * Specialized for async/Promise-returning methods
 */
function TraceAsync(options = {}) {
  return Trace({ ...options, async: true });
}

/**
 * @TraceIf() conditional tracing decorator
 *
 * Only traces when condition returns true
 */
function TraceIf(condition, options = {}) {
  return function (target, propertyKey, descriptor) {
    if (!descriptor) {
      throw new Error('@TraceIf() can only be applied to methods');
    }

    const className = target.constructor?.name || 'Unknown';
    const methodName = String(propertyKey);
    const originalMethod = descriptor.value;

    descriptor.value = function (...args) {
      // Check condition
      if (!condition(...args)) {
        // Don't trace, just execute
        return originalMethod.apply(this, args);
      }

      // Trace execution
      const wrapped = wrapMethod(originalMethod, className, methodName, options);
      return wrapped.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @TraceReactComponent decorator for React class components
 *
 * Traces React lifecycle methods
 */
function TraceReactComponent(options = {}) {
  return function (constructor) {
    const className = constructor.name;

    // React lifecycle methods to trace
    const lifecycleMethods = [
      'constructor',
      'componentDidMount',
      'componentDidUpdate',
      'componentWillUnmount',
      'shouldComponentUpdate',
      'render',
      'componentDidCatch',
      'getDerivedStateFromProps',
      'getSnapshotBeforeUpdate',
    ];

    lifecycleMethods.forEach((methodName) => {
      const originalMethod = constructor.prototype[methodName];
      if (originalMethod && typeof originalMethod === 'function') {
        const wrappedMethod = wrapMethod(
          originalMethod,
          className,
          methodName,
          { ...options, componentType: 'React' }
        );
        constructor.prototype[methodName] = wrappedMethod;
      }
    });

    // Store metadata
    setMetadata(constructor.prototype, null, {
      ...DEFAULT_OPTIONS,
      ...options,
      componentType: 'React',
    });

    return constructor;
  };
}

/**
 * @TraceVueComponent decorator for Vue class components
 *
 * Traces Vue lifecycle hooks
 */
function TraceVueComponent(options = {}) {
  return function (constructor) {
    const className = constructor.name;

    // Vue lifecycle hooks to trace
    const lifecycleHooks = [
      'beforeCreate',
      'created',
      'beforeMount',
      'mounted',
      'beforeUpdate',
      'updated',
      'beforeUnmount',
      'unmounted',
      'activated',
      'deactivated',
    ];

    lifecycleHooks.forEach((hookName) => {
      const originalHook = constructor.prototype[hookName];
      if (originalHook && typeof originalHook === 'function') {
        const wrappedHook = wrapMethod(
          originalHook,
          className,
          hookName,
          { ...options, componentType: 'Vue' }
        );
        constructor.prototype[hookName] = wrappedHook;
      }
    });

    // Store metadata
    setMetadata(constructor.prototype, null, {
      ...DEFAULT_OPTIONS,
      ...options,
      componentType: 'Vue',
    });

    return constructor;
  };
}

// Export decorators
module.exports = {
  Trace,
  TraceClass,
  ExcludeFromTrace,
  ExcludeParam,
  TraceAsync,
  TraceIf,
  TraceReactComponent,
  TraceVueComponent,
  getMetadata,
  setMetadata,
};

// Global namespace for decorator metadata access
if (typeof global !== 'undefined') {
  global.FlowTrace = global.FlowTrace || {};
  global.FlowTrace.getMetadata = getMetadata;
}
