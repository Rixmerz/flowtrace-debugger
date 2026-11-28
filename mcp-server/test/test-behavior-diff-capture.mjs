// FlowTrace v2 — the behavioural comparison against REAL captures.
// Run with: node test/test-behavior-diff-capture.mjs (after `npm run build`).
//
// test-behavior-diff.mjs feeds the comparison hand-built events, which proves
// the algorithm and nothing about the traces it will actually be given. This
// file runs tiny programs under the real Python and Node capture layers —
// invoked exactly as scripts/golden/runners.mjs invokes them — and asserts the
// two things a characterisation gate lives or dies by:
//
//   1. the SAME program traced twice compares "same". If this fails the tool
//      is useless as a gate, whatever else it gets right;
//   2. two versions that differ in one behaviour compare "different", naming
//      exactly that behaviour and nothing else.
//
// Nothing here is skipped when a runtime is missing: a gate that quietly
// stopped testing itself is how the previous `trace_diff` came to be trusted
// for something it never did.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceBehaviorDiff } from '../dist/behavior-diff.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FIXTURES = path.join(HERE, 'fixtures', 'characterisation');
const NODE_BOOTSTRAP = path.join(REPO, 'capture', 'node', 'src', 'bootstrap.mjs');
const PY_STUB = path.join(REPO, 'capture', 'python', 'stub');
const PY_PKG = path.join(REPO, 'capture', 'python');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-behavior-'));
let seq = 0;

// A FLOWTRACE_ROOT / prefix left in the developer's shell would re-root or
// narrow every capture below.
const BASE_ENV = { ...process.env };
for (const k of Object.keys(BASE_ENV)) if (k.startsWith('FLOWTRACE_')) delete BASE_ENV[k];

function readTrace(out, what, proc) {
  assert.equal(proc.status, 0, `${what} exited ${proc.status}: ${proc.stderr}`);
  assert.ok(fs.existsSync(out), `${what} wrote no trace`);
  const events = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.length > 0, `${what} wrote an empty trace`);
  return events;
}

/** Trace `<lang>/<version>/<name>` under the real capture layer. */
function capture(lang, version, name, extraEnv = {}) {
  const dir = path.join(FIXTURES, lang, version);
  const out = path.join(TMP, `${lang}-${version}-${name}-${seq++}.jsonl`);
  if (lang === 'python') {
    const proc = spawnSync(process.env.PYTHON ?? 'python3', [`${name}.py`], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
      env: {
        ...BASE_ENV,
        PYTHONPATH: [PY_STUB, PY_PKG].join(path.delimiter),
        PYTHONDONTWRITEBYTECODE: '1',
        FLOWTRACE_ENABLE: '1',
        FLOWTRACE_PACKAGE_PREFIX: name,
        FLOWTRACE_OUTPUT: out,
        ...extraEnv,
      },
    });
    return readTrace(out, `python ${version}/${name}.py`, proc);
  }
  const proc = spawnSync(process.execPath, ['--import', `file://${NODE_BOOTSTRAP}`, `${name}.js`], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
    env: { ...BASE_ENV, FLOWTRACE_OUTPUT: out, FLOWTRACE_PACKAGE_PREFIX: `${name}.js`, NODE_OPTIONS: '', ...extraEnv },
  });
  return readTrace(out, `node ${version}/${name}.js`, proc);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ZERO = {
  calls_added: 0, calls_removed: 0, calls_reordered: 0, args_changed: 0,
  result_changed: 0, error_changed: 0, error_msg_changed: 0, count_changed: 0,
};
/** The fixture's two honestly volatile fields: a uuid and a wall-clock time. */
const VOLATILE = { ignore_keys: ['id', 'created_at'] };

for (const lang of ['python', 'node']) {
  test(`${lang}: the same program traced twice is the same`, () => {
    const a = capture(lang, 'v1', 'shop');
    const b = capture(lang, 'v1', 'shop');
    assert.notEqual(a[0].span_id, b[0].span_id, 'two separate runs: the ids differ');
    const d = traceBehaviorDiff(a, b, VOLATILE);
    assert.equal(d.verdict, 'same', JSON.stringify(d.samples));
    assert.deepEqual(d.summary, ZERO);
    assert.equal(d.complete, true);
    assert.equal(d.compared_spans, d.spans_a, 'every span was compared, none skipped');
    assert.ok(d.ignored.keys_a > 0, 'the volatile keys were really there to ignore');
  });

  test(`${lang}: without the ignores, only the volatile fields differ — and they are named`, () => {
    const d = traceBehaviorDiff(capture(lang, 'v1', 'shop'), capture(lang, 'v1', 'shop'));
    assert.equal(d.verdict, 'different');
    assert.deepEqual(d.summary, { ...ZERO, result_changed: 2 }, 'Orders.stamp and its caller Orders.create');
    const keys = new Set(d.samples.result_changed.flatMap((s) => s.diff.map((e) => e.path)));
    assert.deepEqual([...keys].sort(), ['result.value.created_at', 'result.value.id']);
  });

  test(`${lang}: one changed behaviour is named exactly, and nothing else`, () => {
    const d = traceBehaviorDiff(capture(lang, 'v1', 'shop'), capture(lang, 'v2', 'shop'), VOLATILE);
    assert.equal(d.verdict, 'different');
    assert.deepEqual(d.summary, { ...ZERO, result_changed: 1 });
    const [s] = d.samples.result_changed;
    assert.deepEqual(s.path, ['shop.Orders.create', 'shop.Pricing.label']);
    assert.deepEqual(s.diff, [{ path: 'result.value', before: 'TOTAL 35', after: 'Total: 35' }]);
    assert.equal(s.args, '{"total":35}');
  });

  test(`${lang}: values truncated by the capture layer are compared by prefix and flagged`, () => {
    const env = { FLOWTRACE_MAX_ARG_LENGTH: '16' };
    const d = traceBehaviorDiff(capture(lang, 'v1', 'shop', env), capture(lang, 'v1', 'shop', env), VOLATILE);
    // The uuid sits past the 16-character cut, so the truncated results are
    // equal — and the result must say that equality is only prefix-deep.
    assert.equal(d.verdict, 'same', JSON.stringify(d.samples));
    assert.ok(d.truncated_values > 0, 'truncated values were compared');
    assert.ok(d.notes.some((n) => /truncated by the capture layer/.test(n)));
  });
}

test('python: an object passed by reference (address in its repr) does not make two runs differ', () => {
  const a = capture('python', 'v1', 'shop');
  const cart = a.find((e) => e.method === 'create' && e.event === 'enter').args.cart;
  assert.match(cart, /object at 0x[0-9a-f]+>/, `the fixture really emits an address: ${cart}`);
  const d = traceBehaviorDiff(a, capture('python', 'v1', 'shop'), VOLATILE);
  assert.equal(d.summary.args_changed, 0);
});

// -- concurrency -----------------------------------------------------------
//
// What two runs of unchanged concurrent code compare as depends on whether
// scheduling decides the ORDER IN WHICH SIBLINGS START:
//
//   node/pool.js   Promise.all over an array. Every fetchOne is entered
//                  synchronously, in array order, and each later `square`
//                  hangs off its own fetchOne — so the tree is the same
//                  whatever order the timers fire in. Strict compare: same.
//   python/pool.py A 4-worker thread pool over 8 tasks. Tasks 4..7 start
//                  whenever a worker frees up, so the order of `fetch` under
//                  `run` is scheduling. Strict compare may report reordering;
//                  ignore_order must not.

test('node: an async fan-out traced repeatedly is the same, strictly ordered', () => {
  const base = capture('node', 'v1', 'pool');
  for (let i = 0; i < 4; i++) {
    const d = traceBehaviorDiff(base, capture('node', 'v1', 'pool'));
    assert.equal(d.verdict, 'same', `run ${i}: ${JSON.stringify(d.summary)}`);
  }
});

test('python: a thread pool traced repeatedly is the same under ignore_order; strict order sees only moves', () => {
  const base = capture('python', 'v1', 'pool');
  let strictDifferent = 0;
  for (let i = 0; i < 6; i++) {
    const run = capture('python', 'v1', 'pool');
    const loose = traceBehaviorDiff(base, run, { ignore_order: true });
    assert.equal(loose.verdict, 'same', `run ${i}: ${JSON.stringify(loose.summary)}`);
    const strict = traceBehaviorDiff(base, run);
    if (strict.verdict === 'different') {
      strictDifferent++;
      // Scheduling shows up as pure moves — never as a value change or as a
      // call that appeared or vanished.
      assert.deepEqual({ ...strict.summary, calls_reordered: 0 }, ZERO, `run ${i}`);
      assert.ok(strict.notes.some((n) => /several threads/.test(n)), 'the multi-thread caveat is attached');
    }
  }
  console.log(`        (strict order: ${strictDifferent} of 6 repeat runs differed from the first by scheduling alone)`);
});

// -- runner --
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
