// Tests for field-level filtering (src/filter.ts).
// Run with: node test/test-filter.mjs (after `pnpm run build`).

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeMatcher, applyFilters } from '../dist/filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function load(p) {
  return fs.readFileSync(path.join(REPO_ROOT, p), 'utf-8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const JAVA = load('examples/golden/java/expected.jsonl');
const ERR_PY = load('examples/golden/error/python/expected.jsonl');

// -- the motivating case ---------------------------------------------------

test('field filter does not match unrelated fields the way free text does', () => {
  // A row whose *module* contains "calc" but whose method does not.
  const rows = [
    { event: 'enter', method: 'run', class: 'C', module: 'calculator', lang: 'node',
      trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), parent_id: null, depth: 0 },
  ];
  // Free text hits it, because "calc" appears somewhere in the serialized row.
  assert.equal(applyFilters(rows, undefined, 'calc').length, 1);
  // A method-scoped filter does not.
  assert.equal(applyFilters(rows, { method: 'calc' }).length, 0);
  assert.equal(applyFilters(rows, { module: 'calc' }).length, 1);
});

test('an empty where constrains nothing', () => {
  assert.equal(applyFilters(JAVA, {}).length, JAVA.length);
  assert.equal(applyFilters(JAVA, undefined).length, JAVA.length);
});

test('where and free-text filter are ANDed', () => {
  const both = applyFilters(JAVA, { event: 'exit' }, 'run');
  assert.ok(both.every((e) => e.event === 'exit'));
  assert.ok(both.every((e) => JSON.stringify(e).includes('run')));
});

// -- per-field semantics ---------------------------------------------------

test('string fields match case-insensitively by substring', () => {
  const m = makeMatcher({ method: 'RU' });
  assert.equal(JAVA.filter(m).length, JAVA.filter((e) => /run/i.test(e.method)).length);
  assert.ok(JAVA.filter(m).length > 0);
});

test('ids match exactly, not by substring', () => {
  const traceId = JAVA[0].trace_id;
  assert.equal(applyFilters(JAVA, { trace_id: traceId }).length, JAVA.length);
  // A prefix of a real id must not match — ids are opaque.
  assert.equal(applyFilters(JAVA, { trace_id: traceId.slice(0, 8) }).length, 0);
});

test('event filter selects a single variant', () => {
  const enters = applyFilters(JAVA, { event: 'enter' });
  assert.ok(enters.length > 0);
  assert.ok(enters.every((e) => e.event === 'enter'));
  assert.equal(enters.length + applyFilters(JAVA, { event: 'exit' }).length, JAVA.length);
});

test('has_error isolates failing exits', () => {
  const failing = applyFilters(ERR_PY, { has_error: true });
  assert.deepEqual(failing.map((e) => e.method).sort(), ['inner', 'outer']);
  const clean = applyFilters(ERR_PY, { has_error: false });
  assert.ok(clean.every((e) => !(e.event === 'exit' && e.error)));
  assert.equal(failing.length + clean.length, ERR_PY.length);
});

test('has_error:false does not sweep in enter events as errors', () => {
  // enter events carry no error, so they belong to the false bucket.
  const clean = applyFilters(ERR_PY, { has_error: false });
  assert.ok(clean.some((e) => e.event === 'enter'));
});

// -- numeric ranges --------------------------------------------------------

test('a duration range implies exit events only', () => {
  // The trap this guards: comparing undefined durations on enter events yields
  // NaN, and `NaN < min` is false, so a naive implementation would let every
  // enter event through a min_duration_ns:0 filter.
  const r = applyFilters(JAVA, { min_duration_ns: 0 });
  assert.ok(r.length > 0);
  assert.ok(r.every((e) => e.event === 'exit'), 'no enter events in a duration-filtered set');
});

test('duration bounds are inclusive and actually bound', () => {
  const d = JAVA.find((e) => e.event === 'exit').duration_ns;
  assert.ok(applyFilters(JAVA, { min_duration_ns: d, max_duration_ns: d }).length > 0);
  assert.equal(applyFilters(JAVA, { min_duration_ns: d + 1 }).length, 0);
  assert.equal(applyFilters(JAVA, { max_duration_ns: d - 1 }).length, 0);
});

test('depth bounds select tree levels', () => {
  const roots = applyFilters(JAVA, { max_depth: 0 });
  assert.ok(roots.length > 0);
  assert.ok(roots.every((e) => e.depth === 0));
  assert.ok(applyFilters(JAVA, { min_depth: 1 }).every((e) => e.depth >= 1));
});

// -- composition -----------------------------------------------------------

test('multiple predicates are ANDed, not ORed', () => {
  const r = applyFilters(ERR_PY, { event: 'exit', method: 'inner' });
  assert.equal(r.length, 1);
  assert.equal(r[0].method, 'inner');
  assert.equal(r[0].event, 'exit');
});

test('a predicate matching nothing yields nothing rather than everything', () => {
  assert.equal(applyFilters(JAVA, { method: 'nosuchmethodanywhere' }).length, 0);
});

// -- runner --
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
