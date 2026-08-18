/**
 * Reports whether both ESM import styles of node:http observe the patch.
 *
 * Run as `node --import <bootstrap> facade-probe.mjs`, which is the real
 * ordering: the bootstrap is fully evaluated before this module's graph is
 * linked, so the builtin's ESM facade is built from already-patched exports.
 */
const { request: named } = await import('node:http');
const http = (await import('node:http')).default;
const PATCHED = Symbol.for('flowtrace.propagate.patched');

// console.log, not process.stdout.write: writes to a pipe are asynchronous and
// a bare write can be lost when the process exits immediately after it — the
// same class of loss the emitter had to solve with writeSync.
console.log(JSON.stringify({
  named: Boolean(named[PATCHED]),
  default: Boolean(http.request[PATCHED]),
}));
