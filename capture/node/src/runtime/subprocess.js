/**
 * Trace context across a process spawn.
 *
 * `bootstrap.mjs` already propagates the *instrumentation* to children through
 * NODE_OPTIONS, but that only makes a child emit events — it does not make
 * those events belong to the parent's trace. A Node parent shelling out to a
 * traced Java, Python or Node program produced two unrelated traces.
 *
 * HTTP has `traceparent` as its carrier. A process spawn has no header, so the
 * environment is the carrier: FLOWTRACE_TRACEPARENT holds the same W3C value,
 * every runtime reads it at startup, and the child's root span adopts the
 * parent's trace and hangs off the spawning span.
 *
 * That closes the non-HTTP chains: test runners, build tools, CLI pipelines,
 * anything that shells out.
 *
 * Every patch is idempotent and fails open — a tracing concern must never stop
 * the caller from spawning.
 */

import { createRequire } from 'node:module';
import { currentTraceparent } from './context.js';

// Reached via createRequire, not a static import, for the same reason as in
// propagate.js: a static ESM import of a builtin creates its facade, which
// snapshots the named exports *before* we patch. Applications importing
// `{ spawn }` would then silently keep the unpatched function while those
// importing the default object got the patched one.
const child_process = createRequire(import.meta.url)('node:child_process');

/** The environment carrier. Node, Python and Java all read this name. */
export const TRACEPARENT_ENV = 'FLOWTRACE_TRACEPARENT';

const PATCHED = Symbol.for('flowtrace.subprocess.patched');

/**
 * Returns a copy of `args` whose options bag carries the traceparent in `env`,
 * inserting a bag when the caller passed none.
 *
 * The child_process signatures vary — spawn(cmd, args, opts),
 * exec(cmd, opts, cb), fork(path, args, opts), and every prefix of those. Two
 * rules hold across all of them: the options bag is the last non-array object
 * argument, and a callback comes after it. So the last plain object is taken
 * as the bag, and otherwise a fresh one is spliced in just before the first
 * function argument.
 *
 * @param {unknown[]} args
 * @param {string} traceparent
 * @returns {unknown[]}
 */
export function withTraceparentEnv(args, traceparent) {
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
  // The bag is cloned, never mutated: rewriting a caller's options object is an
  // observable side effect, and a reused bag would carry a stale span onward.
  // `env` defaults to process.env when absent, so that semantics is preserved.
  next[optIdx] = {
    ...bag,
    env: { ...(bag.env ?? process.env), [TRACEPARENT_ENV]: traceparent },
  };
  return next;
}

function wrap(original) {
  const wrapper = function flowtraceSpawn(...args) {
    try {
      const traceparent = currentTraceparent();
      if (traceparent) args = withTraceparentEnv(args, traceparent);
    } catch {
      // Fail open.
    }
    return original.apply(this, args);
  };
  wrapper[PATCHED] = true;
  return wrapper;
}

/**
 * Installs child-process trace propagation. Safe to call more than once.
 * @returns {boolean} true when propagation is active after this call.
 */
export function installSubprocessPropagation() {
  if (process.env.FLOWTRACE_PROPAGATE === '0') return false;
  try {
    for (const name of [
      'spawn', 'spawnSync',
      'exec', 'execSync',
      'execFile', 'execFileSync',
      'fork',
    ]) {
      const original = child_process[name];
      if (typeof original === 'function' && !original[PATCHED]) {
        child_process[name] = wrap(original);
      }
    }
    return true;
  } catch {
    return false;
  }
}
