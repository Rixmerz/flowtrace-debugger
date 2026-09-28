// FlowTrace v2 — tests for the layered trace tools (search / topology /
// span details / errors / critical path) and read_skill content.
// Run with: node test/test-layered-tools.mjs (after `npm run build`).

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  traceSearch,
  traceTopology,
  traceSpanDetails,
  traceErrors,
  traceCriticalPath,
} from '../dist/trace-tools.js';
import { SKILLS, readSkill } from '../dist/skills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const load = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const T = 'a'.repeat(32);
const T0 = 1000;
const MS = 1e6;
// root 0-100ms; A 10-40 (C 20-25 inside it); B 30-90 overlaps A (async).
function span(id, parent, name, startMs, durMs, extra = {}) {
  const base = { trace_id: T, span_id: id, parent_id: parent, thread: 'main', lang: 'node', module: 'm', class: 'K', method: name, visibility: 'public', depth: 0, args: { n: id } };
  return [
    { ...base, ts: T0 + startMs / 1000, event: 'enter' },
    { ...base, ts: T0 + (startMs + durMs) / 1000, event: 'exit', result: {}, duration_ns: durMs * MS, ...extra },
  ];
}
const synthetic = [
  ...span('r', null, 'root', 0, 100),
  ...span('a', 'r', 'A', 10, 30),
  ...span('c', 'a', 'C', 20, 5, { error: { type: 'Boom', msg: 'x', stack: [] } }),
  ...span('b', 'r', 'B', 30, 60),
];

test('trace_critical_path follows last-finishing children and sums to the root duration', () => {
  const r = traceCriticalPath(synthetic, T);
  assert.equal(r.total_ns, 100 * MS);
  const self = Object.fromEntries(r.by_span.map((s) => [s.method ?? s.name.split('.').pop(), s.self_ns]));
  assert.deepEqual(self, { B: 60 * MS, root: 20 * MS, A: 15 * MS, C: 5 * MS });
  assert.equal(r.by_span[0].name, 'm.K.B', 'largest contributor first');
  const sum = r.sections.reduce((n, s) => n + s.self_ns, 0);
  assert.equal(sum, r.total_ns, 'sections tile the root exactly');
});

test('trace_critical_path on an unknown trace is empty, not a throw', () => {
  assert.deepEqual(traceCriticalPath(synthetic, 'f'.repeat(32)).sections, []);
});

test('trace_search summarises per trace and filters', () => {
  const r = traceSearch(synthetic);
  assert.equal(r.total, 1);
  assert.deepEqual(r.traces[0], {
    trace_id: T, root: 'm.K.root', start_ts: T0, duration_ns: 100 * MS,
    span_count: 4, error_count: 1, threads: ['main'], langs: ['node'],
  });
  assert.equal(traceSearch(synthetic, { has_error: false }).total, 0);
  assert.equal(traceSearch(synthetic, { method: 'k.c' }).total, 1);
  assert.equal(traceSearch(synthetic, { method: 'nope' }).total, 0);
  assert.equal(traceSearch(synthetic, { min_duration_ns: 200 * MS }).total, 0);
});

test('trace_search reports truncation against total', () => {
  const two = [...synthetic, ...synthetic.map((e) => ({ ...e, trace_id: 'b'.repeat(32), ts: e.ts + 1 }))];
  const r = traceSearch(two, { limit: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.returned, 1);
  assert.equal(r.truncated, true);
});

test('trace_topology is depth-first with ancestry paths and no payloads', () => {
  const r = traceTopology(synthetic, T);
  assert.deepEqual(r.spans.map((s) => s.path), ['r', 'r/a', 'r/a/c', 'r/b']);
  assert.equal(r.spans[1].self_ns, 25 * MS, 'self = duration minus children');
  assert.equal(r.spans[0].self_ns, 10 * MS, 'overlapping children still clamp at zero or above');
  assert.equal(r.spans[2].error, true);
  assert.ok(!('args' in r.spans[0]), 'topology carries no args');
  const capped = traceTopology(synthetic, T, { limit: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.total, 4);
});

test('trace_span_details returns full events and names missing ids', () => {
  const r = traceSpanDetails(synthetic, ['c', 'zz', 'c']);
  assert.equal(r.requested, 2);
  assert.deepEqual(r.not_found, ['zz']);
  assert.equal(r.spans[0].exit.error.type, 'Boom');
  assert.deepEqual(r.spans[0].enter.args, { n: 'c' });
});

test('trace_errors returns every error with path and total count', () => {
  const r = traceErrors(synthetic);
  assert.equal(r.total_error_count, 1);
  assert.deepEqual(r.errors[0].path.map((p) => p.span_id), ['r', 'a', 'c']);
  assert.deepEqual(r.errors[0].args, { n: 'c' });
});

for (const lang of ['java', 'node', 'python', 'go']) {
  test(`layered tools agree with the ${lang} error golden`, () => {
    const events = load(`examples/golden/error/${lang}/expected.jsonl`);
    const { traces } = traceSearch(events);
    assert.ok(traces.length >= 1);
    const errs = traceErrors(events);
    assert.ok(errs.total_error_count >= 1, 'golden records a failure');
    const traceId = errs.errors[0].trace_id;
    const topo = traceTopology(events, traceId);
    assert.equal(topo.truncated, false);
    assert.ok(topo.spans.some((s) => s.error));
    const cp = traceCriticalPath(events, traceId);
    const sum = cp.sections.reduce((n, s) => n + s.self_ns, 0);
    assert.equal(sum, cp.total_ns, 'critical path tiles the root');
  });
}

test('read_skill serves an index that names every sub-skill', () => {
  const index = readSkill('SKILL.md');
  for (const name of Object.keys(SKILLS)) if (name !== 'SKILL.md') assert.ok(index.includes(name), name);
  assert.throws(() => readSkill('../etc/passwd'), /Unknown skill/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.error(`  FAIL ${name}\n${e.stack}`); }
}
if (failed) process.exit(1);
