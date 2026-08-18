// FlowTrace v2 — unit tests for trace_* tools.
// Run with: node test/test-trace-tools.mjs (after `npm run build`).

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  traceTree,
  traceFindError,
  tracePrivateCalls,
  traceDiff,
} from '../dist/trace-tools.js';
import { detectSchemaVersion, isLikelyV2 } from '../dist/v1-compat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const JAVA_GOLDEN = path.join(REPO_ROOT, 'examples/golden/java/expected.jsonl');

function loadJsonlSync(p) {
  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// -- trace_tree --
test('trace_tree builds nested structure for java golden', () => {
  const events = loadJsonlSync(JAVA_GOLDEN);
  const traceId = events[0].trace_id;
  const roots = traceTree(events, traceId);
  assert.equal(roots.length, 1, 'one root per golden trace');
  const root = roots[0];
  assert.equal(root.method, 'run');
  assert.ok(root.children.length > 0, 'root has children');
  // depth should increase
  const depths = new Set();
  function walk(n) { depths.add(n.depth); n.children.forEach(walk); }
  walk(root);
  assert.ok(depths.has(0));
  assert.ok([...depths].some((d) => d >= 2), 'tree reaches depth >= 2');
});

// -- trace_find_error --
test('trace_find_error returns null when no error in golden', () => {
  const events = loadJsonlSync(JAVA_GOLDEN);
  const r = traceFindError(events);
  assert.equal(r, null);
});

test('trace_find_error walks parents to root from a failing exit', () => {
  // This used to build its error as `event: 'error'`, a variant schema v2 does
  // not define and no capture layer emits. The test passed against data that
  // could never occur while the real shape — an `exit` carrying `error` — went
  // untested, and Python's divergent output went unnoticed for the same reason.
  const trace_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const e = (over) => ({
    ts: 0, trace_id, thread: 'main', lang: 'node', method: 'm', ...over,
  });
  const events = [
    e({ ts: 1, span_id: 's1', parent_id: null, event: 'enter', method: 'root', class: 'A' }),
    e({ ts: 2, span_id: 's2', parent_id: 's1', event: 'enter', method: 'mid',  class: 'A' }),
    e({ ts: 3, span_id: 's3', parent_id: 's2', event: 'enter', method: 'leaf', class: 'A' }),
    e({ ts: 4, span_id: 's3', parent_id: 's2', event: 'exit', method: 'leaf', class: 'A',
        result: {}, error: { type: 'RuntimeError', msg: 'boom', stack: [] } }),
  ];
  const r = traceFindError(events);
  assert.ok(r);
  assert.equal(r.error.type, 'RuntimeError');
  assert.deepEqual(r.path.map((p) => p.method), ['root', 'mid', 'leaf']);
});

// Against the real captured output of all three languages, not a hand-written
// approximation of it. The Python case is the one that matters most: its old
// shape (`result: {error}`, no top-level `error`) was schema-VALID, so no
// amount of schema validation could catch it — find_error simply returned null
// on a trace full of exceptions. Only asserting on real capture output does.
for (const lang of ['python', 'node', 'java']) {
  test(`trace_find_error finds the error in the ${lang} golden error fixture`, () => {
    const events = loadJsonlSync(
      path.join(REPO_ROOT, `examples/golden/error/${lang}/expected.jsonl`)
    );
    const r = traceFindError(events);
    assert.ok(r, `find_error returned null for ${lang} — the error is invisible to consumers`);
    assert.match(r.error.msg, /inner refused 7/);
    assert.ok(r.error.type.length > 0, 'error carries a type');
    // inner() threw and outer() did not catch, so the path reaches both.
    assert.deepEqual(r.path.slice(-2).map((p) => p.method), ['outer', 'inner']);
  });

  test(`${lang} error fixture reports the error on every frame it propagated through`, () => {
    const events = loadJsonlSync(
      path.join(REPO_ROOT, `examples/golden/error/${lang}/expected.jsonl`)
    );
    const failed = events.filter((e) => e.event === 'exit' && e.error);
    assert.deepEqual(
      failed.map((e) => e.method).sort(),
      ['inner', 'outer'],
      'an unhandled throw must mark every frame it unwound through, not just its origin'
    );
    // schema v2 requires `result` on every exit; Java and Node both used to
    // omit it precisely on this branch.
    for (const e of failed) {
      assert.deepEqual(e.result, {}, `${e.method}: a throwing call carries an empty result`);
      assert.ok(Array.isArray(e.error.stack) && e.error.stack.length > 0, 'stack captured');
    }
  });
}

// -- trace_private_calls --
test('trace_private_calls counts private methods in java golden', () => {
  const events = loadJsonlSync(JAVA_GOLDEN);
  const r = tracePrivateCalls(events);
  assert.ok(r.length > 0, 'java golden has private calls');
  const validate = r.find((x) => x.method === 'validate');
  assert.ok(validate, 'expected validate() in private calls');
  assert.ok(validate.count >= 1);
});

// -- trace_diff --
test('trace_diff detects only-in-A and duration delta > 20%', () => {
  const trace_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const mk = (method, dur, span) => [
    { ts: 0, trace_id, span_id: span, parent_id: null, event: 'enter', thread: 't',
      lang: 'node', method, class: 'X' },
    { ts: 1, trace_id, span_id: span, parent_id: null, event: 'exit',  thread: 't',
      lang: 'node', method, class: 'X', duration_ns: dur },
  ];
  const a = [...mk('foo', 1000, 's1'), ...mk('only_a', 500, 's2')];
  const b = [...mk('foo', 2000, 's3'), ...mk('only_b', 700, 's4')];
  const d = traceDiff(a, b);
  assert.deepEqual(d.only_in_a, ['X.only_a']);
  assert.deepEqual(d.only_in_b, ['X.only_b']);
  assert.equal(d.duration_deltas.length, 1);
  assert.equal(d.duration_deltas[0].method, 'X.foo');
  assert.equal(d.duration_deltas[0].delta_pct, 100);
});

// -- v1 compat --
test('v1-compat detects v1 logs and isLikelyV2 rejects them', () => {
  const v1 = { timestamp: 1730000000000, event: 'ENTER', class: 'X', method: 'm' };
  assert.equal(detectSchemaVersion(v1), 'v1');
  assert.equal(isLikelyV2(v1), false);
  const v2 = { ts: 1.0, trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), event: 'enter',
                thread: 't', lang: 'node', method: 'm' };
  assert.equal(detectSchemaVersion(v2), 'v2');
  assert.equal(isLikelyV2(v2), true);
});

// -- runner --
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
