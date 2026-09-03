/**
 * Trace propagation into worker_threads.
 *
 * A Worker inherits NODE_OPTIONS, so the bootstrap runs inside it and its code
 * is instrumented — but AsyncLocalStorage does not cross the thread boundary,
 * so every worker used to start an unrelated root trace. The carrier that
 * already exists for child processes is the environment: `seedFromEnvironment`
 * reads FLOWTRACE_TRACEPARENT at bootstrap, and a Worker's `env` option is
 * copied at construction. Setting it here is enough for the worker's first
 * span to hang off the span that created the worker.
 *
 * Mirrors runtime/subprocess.js. `env: SHARE_ENV` is left alone — writing into
 * a shared environment would leak this span into every other thread.
 */

import { createRequire } from 'node:module';
import { currentTraceparent } from './context.js';

const _require = createRequire(import.meta.url);
const worker_threads = _require('node:worker_threads');
const nodeModule = _require('node:module');

const TRACEPARENT_ENV = 'FLOWTRACE_TRACEPARENT';
const PATCHED = Symbol.for('flowtrace.workers.patched');

function withTraceparent(options, traceparent) {
  const bag = options && typeof options === 'object' ? options : {};
  if (bag.env === worker_threads.SHARE_ENV) return bag;
  return { ...bag, env: { ...(bag.env ?? process.env), [TRACEPARENT_ENV]: traceparent } };
}

/**
 * Installs worker-thread trace propagation. Safe to call more than once.
 * @returns {boolean} true when propagation is active after this call.
 */
export function installWorkerPropagation() {
  if (process.env.FLOWTRACE_PROPAGATE === '0') return false;
  try {
    const Original = worker_threads.Worker;
    if (Original[PATCHED]) return true;

    class FlowtraceWorker extends Original {
      constructor(filename, options) {
        let opts = options;
        try {
          const traceparent = currentTraceparent();
          if (traceparent) opts = withTraceparent(options, traceparent);
        } catch {
          // Fail open.
        }
        super(filename, opts);
      }
    }
    Object.defineProperty(FlowtraceWorker, 'name', { value: 'Worker' });
    FlowtraceWorker[PATCHED] = true;

    worker_threads.Worker = FlowtraceWorker;
    // `import { Worker } from 'node:worker_threads'` binds to the ESM facade of
    // the builtin; this re-syncs it with the CJS export we just replaced.
    if (typeof nodeModule.syncBuiltinESMExports === 'function') {
      nodeModule.syncBuiltinESMExports();
    }
    return true;
  } catch {
    return false;
  }
}
