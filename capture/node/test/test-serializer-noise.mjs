/**
 * Spans the program did not cause.
 *
 * Serialising args / results / errors runs user code (toJSON, getters,
 * toString, Symbol.toPrimitive, util.inspect.custom). On an instrumented class
 * that must not produce spans, and generator functions must not leave a span
 * current across a yield. Each test runs a tiny program under the real
 * bootstrap in a subprocess, like test-cjs-integration.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const BOOTSTRAP = join(dirname(fileURLToPath(import.meta.url)), '../src/bootstrap.mjs');

function run(source) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-noise-'));
  try {
    const script = join(dir, 'prog.js');
    writeFileSync(script, source);
    const out = join(dir, 't.jsonl');
    const r = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, script], {
      env: { ...process.env, FLOWTRACE_OUTPUT: out, FLOWTRACE_PACKAGE_PREFIX: '', NODE_OPTIONS: '' },
      cwd: dir, timeout: 30000, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const enters = (evs) => evs.filter((e) => e.event === 'enter');
const byMethod = (evs, m) => enters(evs).filter((e) => e.method === m);

test('toJSON / toString / getter / toPrimitive / inspect.custom run by the serializer emit no span', () => {
  const evs = run(`
const util = require('node:util');
class P {
  toJSON() { return 'P-json'; }
  toString() { return 'P-str'; }
  get g() { return 1; }
  [Symbol.toPrimitive]() { return 'P-prim'; }
  [util.inspect.custom]() { return 'P-inspect'; }
}
class Boom extends Error { get message() { return this.fmt(); } fmt() { return 'boom-text'; } }
class R { toJSON() { return 'R-json'; } }
function takes(p) { return new R(); }
function raises(p) { throw new Boom(); }
function userCall() { return JSON.stringify(new P()); }
function main() {
  takes(new P());
  try { raises(new P()); } catch {}
  userCall();
}
main();
`);
  const toJSONs = byMethod(evs, 'toJSON');
  // Only the toJSON the program itself triggered (JSON.stringify in userCall) is traced.
  assert.equal(toJSONs.length, 1, JSON.stringify(toJSONs.map((e) => e.class)));
  assert.equal(toJSONs[0].class, 'P');
  const parent = enters(evs).find((e) => e.span_id === toJSONs[0].parent_id);
  assert.equal(parent.method, 'userCall');
  assert.equal(byMethod(evs, 'fmt').length, 0);
  assert.equal(byMethod(evs, 'toString').length, 0);
  // Text still recorded.
  assert.deepEqual(byMethod(evs, 'takes')[0].args, { p: 'P-json' });
  const takesExit = evs.find((e) => e.event === 'exit' && e.method === 'takes');
  assert.deepEqual(takesExit.result, { value: 'R-json' });
  const raisesExit = evs.find((e) => e.event === 'exit' && e.method === 'raises');
  assert.equal(raisesExit.error.msg, 'boom-text');
});

test('calls made by a serializer callback do not disturb the span context', () => {
  const evs = run(`
function helper() { return 1; }
class Q { toJSON() { helper(); return 'Q'; } }
function takes(q) { helper(); }
function main() { takes(new Q()); }
main();
`);
  assert.deepEqual(enters(evs).map((e) => e.method), ['main', 'takes', 'helper']);
  const by = Object.fromEntries(enters(evs).map((e) => [e.method, e]));
  assert.equal(by.helper.parent_id, by.takes.span_id);
  assert.equal(by.takes.parent_id, by.main.span_id);
});

test('generator functions are not instrumented, so no span stays current across a yield', () => {
  const evs = run(`
function after() { return 3; }
function* gen() { yield 1; yield 2; }
async function* agen() { yield 1; }
function start() { const g = gen(); g.next(); return g; }
async function main() {
  const g = start();
  after();
  [...g];
  for await (const _ of agen()) after();
}
main();
`);
  assert.equal(byMethod(evs, 'gen').length, 0);
  assert.equal(byMethod(evs, 'agen').length, 0);
  const main = byMethod(evs, 'main')[0];
  const afters = byMethod(evs, 'after');
  assert.equal(afters.length, 2);
  for (const a of afters) assert.equal(a.parent_id, main.span_id);
});
