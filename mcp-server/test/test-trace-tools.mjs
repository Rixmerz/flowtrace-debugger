// FlowTrace v2 — unit tests for trace.* tools.
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

// -- trace.tree --
test('trace.tree builds nested structure for java golden', () => {
  const events = loadJsonlSync(JAVA_GOLDEN);
  const traceId = events[0].trace_id;
  const roots = traceTree(events, traceId);
  assert.equal(roots.length, 1, 'one root per golden trace');
  const root = roots[0];

  // Asserted structurally, not by name. This required root.method === 'run',
  // which only held while the Java fixture's main() did nothing but call run().
  // The fixture now also exercises a plain function and an error path, so main is
  // the root and run is one of its children — a fixture growing coverage should
  // not read as a regression. (Java has a single trace here because main() is
  // itself instrumented and wraps everything; in Node and Python each
  // module-level call starts its own trace.)
  assert.equal(root.depth, 0, 'the root is at depth 0');
  assert.equal(root.parent_id, null, 'the root has no parent');
  assert.ok(root.children.length > 0, 'root has children');

  // The call chain the fixture exists to demonstrate must still be intact.
  const byMethod = new Map();
  (function index(n) { byMethod.set(n.method, n); n.children.forEach(index); })(root);
  for (const m of ['run', 'add', 'validate']) {
    assert.ok(byMethod.has(m), `expected ${m} somewhere in the tree`);
  }
  assert.ok(
    byMethod.get('add').depth > byMethod.get('run').depth,
    'add should nest below run'
  );
  // depth should increase
  const depths = new Set();
  function walk(n) { depths.add(n.depth); n.children.forEach(walk); }
  walk(root);
  assert.ok(depths.has(0));
  assert.ok([...depths].some((d) => d >= 2), 'tree reaches depth >= 2');
});

// -- trace.find_error --
test('trace.find_error finds the error the java golden raises', () => {
  // The fixture now throws once on purpose, precisely so the error path is
  // covered. This test previously asserted find_error returned NULL here, which
  // only held while no golden fixture exercised a failure at all — so the single
  // most important query in the server was never tested against real captured
  // data.
  const events = loadJsonlSync(JAVA_GOLDEN);
  const r = traceFindError(events);
  assert.ok(r, 'find_error found nothing in a trace that contains an error');
  assert.equal(r.error.type, 'java.lang.IllegalStateException');
  assert.match(r.error.msg, /golden failure/);
  assert.ok(Array.isArray(r.path) && r.path.length > 0, 'no root->error path returned');
  // The path must start at the root and end at the failing span.
  assert.equal(r.path[r.path.length - 1].method, 'mustFail');
});

test('trace.find_error returns null for a trace with no error', () => {
  const trace_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const e = (over) => ({ ts: 0, trace_id, thread: 'main', lang: 'node', ...over });
  const events = [
    e({ ts: 1, span_id: 's1', parent_id: null, event: 'enter', method: 'ok', class: 'A' }),
    e({ ts: 2, span_id: 's1', parent_id: null, event: 'exit', method: 'ok', class: 'A' }),
  ];
  assert.equal(traceFindError(events), null);
});

test('trace.find_error walks parents to root from a crafted error', () => {
  const trace_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const e = (over) => ({
    ts: 0, trace_id, thread: 'main', lang: 'node', method: 'm', ...over,
  });
  const events = [
    e({ ts: 1, span_id: 's1', parent_id: null, event: 'enter', method: 'root', class: 'A' }),
    e({ ts: 2, span_id: 's2', parent_id: 's1', event: 'enter', method: 'mid',  class: 'A' }),
    e({ ts: 3, span_id: 's3', parent_id: 's2', event: 'enter', method: 'leaf', class: 'A' }),
    e({ ts: 4, span_id: 's3', parent_id: 's2', event: 'error', method: 'leaf', class: 'A',
        error: { type: 'RuntimeError', msg: 'boom' } }),
  ];
  const r = traceFindError(events);
  assert.ok(r);
  assert.equal(r.error.type, 'RuntimeError');
  assert.deepEqual(r.path.map((p) => p.method), ['root', 'mid', 'leaf']);
});

// -- trace.private_calls --
test('trace.private_calls counts private methods in java golden', () => {
  const events = loadJsonlSync(JAVA_GOLDEN);
  const r = tracePrivateCalls(events);
  assert.ok(r.length > 0, 'java golden has private calls');
  const validate = r.find((x) => x.method === 'validate');
  assert.ok(validate, 'expected validate() in private calls');
  assert.ok(validate.count >= 1);
});

// -- trace.diff --
test('trace.diff detects only-in-A and duration delta > 20%', () => {
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
