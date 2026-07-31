/**
 * Process-boundary trace-context propagation for FlowTrace v2.
 *
 * bootstrap.mjs already propagates the *instrumentation* to children via
 * NODE_OPTIONS, but that only makes a child emit events — it does not make
 * those events belong to the parent's trace. This module injects
 * FLOWTRACE_TRACEPARENT into the child environment so the child's root span
 * adopts the parent's trace_id and points parent_id at the spawning span.
 *
 * That closes the loop for non-HTTP chains: test runners, build tools, CLI
 * pipelines, and any parent that shells out to a traced program in another
 * repo.
 *
 * All patches are idempotent and fail open.
 */

import { createRequire } from 'node:module';

import { TRACEPARENT_ENV, currentTraceparent } from './propagation.js';

// IMPORTANT: obtained via createRequire, NOT `import child_process from ...`.
//
// A builtin's ESM facade snapshots its named exports from the CJS exports at
// facade-creation time, and the facade is created on the first *ESM* import of
// that builtin. Using a static import here would create the facade before we
// patch, so user code doing `import { spawn } from 'node:child_process'` would
// keep binding the ORIGINAL function and silently skip propagation — while
// `import cp from 'node:child_process'; cp.spawn()` would work. That
// inconsistency is worse than no patch at all.
//
// createRequire reaches the CJS exports object without creating the facade, so
// the facade is later built from the already-patched exports and both import
// styles observe the patch. Verified by test/test-propagation-subprocess.mjs.
const child_process = createRequire(import.meta.url)('node:child_process');

let installed = false;

/**
 * Return a copy of `args` in which the options bag carries the traceparent env
 * var, inserting an options bag if the caller did not pass one.
 *
 * The child_process signatures vary a lot — spawn(cmd, args, options),
 * exec(cmd, options, cb), fork(path, args, options), and every prefix of
 * those. The rules that hold across all of them: the options bag is the last
 * non-array object argument, and any callback comes after it. So we take the
 * last plain object as the bag, and otherwise splice a fresh one in just
 * before the first function argument.
 *
 * The bag is cloned rather than mutated — silently rewriting a caller's
 * options object would be an observable side effect.
 *
 * @param {unknown[]} args
 * @param {string} traceparent
 * @returns {unknown[]}
 */
function withTraceparentEnv(args, traceparent) {
  let optIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) optIdx = i;
  }

  let next = [...args];
  if (optIdx === -1) {
    let insertAt = next.findIndex((a) => typeof a === 'function');
    if (insertAt === -1) insertAt = next.length;
    next = [...next.slice(0, insertAt), {}, ...next.slice(insertAt)];
    optIdx = insertAt;
  }

  const bag = next[optIdx];
  // options.env defaults to process.env when absent; preserve that semantics.
  next[optIdx] = {
    ...bag,
    env: { ...(bag.env ?? process.env), [TRACEPARENT_ENV]: traceparent },
  };
  return next;
}

/**
 * @param {Function} original
 * @returns {Function}
 */
function wrap(original) {
  return function flowtraceSpawn(...args) {
    try {
      const traceparent = currentTraceparent();
      if (traceparent) args = withTraceparentEnv(args, traceparent);
    } catch {
      // Fail open — a tracing concern must not stop the caller spawning.
    }
    return original.apply(this, args);
  };
}

/**
 * Install child-process trace-context propagation. Idempotent.
 */
export function install() {
  if (installed) return;
  installed = true;

  for (const name of [
    'spawn', 'spawnSync',
    'exec', 'execSync',
    'execFile', 'execFileSync',
    'fork',
  ]) {
    if (typeof child_process[name] === 'function') {
      child_process[name] = wrap(child_process[name]);
    }
  }
}
