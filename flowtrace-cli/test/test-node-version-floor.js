/**
 * The Node capture layer needs module.register() (Node 20.6+), but the CLI's
 * engines floor is 18 so it can trace Java/Python/Go there. Without an explicit
 * refusal a Node 18 user gets an EMPTY trace, which reads as "my code never
 * ran" — the most misleading failure this tool can produce.
 */
const assert = require('node:assert');
const path = require('node:path');
const { readFileSync } = require('node:fs');

const SRC = readFileSync(path.join(__dirname, '..', 'lib', 'commands', 'run.js'), 'utf8');

// The floor itself, so a careless edit to the constant is caught.
const m = /const NODE_CAPTURE_MIN = \[(\d+), (\d+)\]/.exec(SRC);
assert.ok(m, 'NODE_CAPTURE_MIN not found in run.js');
assert.deepStrictEqual([Number(m[1]), Number(m[2])], [20, 6],
  'Node capture floor must be 20.6 — module.register() landed there');

// The comparison must reject 18.x and 20.5, and accept 20.6 and 22.
const nodeTooOld = new Function('version', `
  const NODE_CAPTURE_MIN = [${m[1]}, ${m[2]}];
  const [maj, min] = version.split('.').map(Number);
  const [reqMaj, reqMin] = NODE_CAPTURE_MIN;
  return maj < reqMaj || (maj === reqMaj && min < reqMin);
`);
for (const [v, want] of [
  ['18.20.4', true], ['20.5.1', true], ['20.6.0', false], ['20.19.0', false],
  ['22.0.0', false], ['26.4.0', false],
]) {
  assert.strictEqual(nodeTooOld(v), want, `nodeTooOld(${v}) should be ${want}`);
}

// It must refuse BEFORE resolving assets or spawning — a late check still
// produces the confusing empty trace it exists to prevent.
const body = SRC.slice(SRC.indexOf('async function runNode'));
assert.ok(
  body.indexOf('nodeTooOld()') < body.indexOf('assets.nodeBootstrap()'),
  'the version check must run before any other work in runNode'
);

console.log('1 passed, 0 failed  (node capture version floor)');
