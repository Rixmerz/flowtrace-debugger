/**
 * Proves trace context survives a process *spawn*, not just an HTTP hop.
 *
 * HTTP has `traceparent` as its carrier and the OTel agent handles it for Java
 * for free. A spawn has no header, so the environment is the carrier — and
 * nothing verified that until this test. Without it, a test runner, build tool
 * or CLI pipeline that shells out produced two unrelated traces.
 *
 * These spawn real OS processes. Like test-cross-process.mjs, this cannot be a
 * golden fixture: the normalizer rewrites every trace_id to one constant, so a
 * fixture would look identical whether or not correlation happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTraceparentEnv, TRACEPARENT_ENV } from '../src/runtime/subprocess.js';
import { seedFromEnvironment, runInSpan, getCurrent } from '../src/runtime/index.js';
import { _clearInheritedContextForTests } from '../src/runtime/context.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const PARENT = join(HERE, 'fixtures', 'spawn-parent.mjs');
const CHILD = join(HERE, 'fixtures', 'spawn-child.mjs');
const PY_CHILD = join(HERE, 'fixtures', 'spawn_child.py');

function readTrace(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Runs the parent fixture, which spawns `cmd`, and returns both traces. */
function runChain(cmd, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-spawn-'));
  const out = join(dir, 'trace.jsonl');
  const res = spawnSync(process.execPath, [PARENT, ...cmd], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, FLOWTRACE_OUTPUT: out, ...extraEnv },
  });
  const events = readTrace(out);
  rmSync(dir, { recursive: true, force: true });
  return { res, events };
}

test('a spawned Node child lands in the parent trace', () => {
  const { res, events } = runChain([process.execPath, CHILD]);
  assert.equal(res.status, 0, `parent failed: ${res.stderr}`);
  assert.equal(events.length, 2, 'one span from each process');

  const parent = events.find((e) => e.module === 'parent');
  const child = events.find((e) => e.module === 'child');
  assert.ok(parent && child, 'both processes emitted');

  assert.equal(child.trace_id, parent.trace_id,
    'the child adopted the parent trace instead of minting its own');
  assert.equal(child.parent_id, parent.span_id,
    "the child span hangs off the spawning process's span");
  assert.equal(parent.parent_id, null, 'the parent is the root');
});

test('a spawned Python child lands in the same trace as its Node parent', () => {
  const { res, events } = runChain([ 'python3', PY_CHILD ], {
    FLOWTRACE_PY_PKG: join(REPO, 'capture', 'python'),
  });
  assert.equal(res.status, 0, `chain failed: ${res.stderr}`);
  const parent = events.find((e) => e.lang === 'node');
  const child = events.find((e) => e.lang === 'python');
  assert.ok(child, 'the Python child emitted');
  assert.equal(child.trace_id, parent.trace_id, 'one trace across two runtimes');
  assert.equal(child.parent_id, parent.span_id);
});

test('a child spawned outside any span starts its own trace', () => {
  // Propagation must not invent context that does not exist.
  const dir = mkdtempSync(join(tmpdir(), 'ft-spawn-'));
  const out = join(dir, 'trace.jsonl');
  try {
    const res = spawnSync(process.execPath, [CHILD], {
      encoding: 'utf8',
      env: { ...process.env, FLOWTRACE_OUTPUT: out },
    });
    assert.equal(res.status, 0);
    const events = readTrace(out);
    assert.equal(events.length, 1);
    assert.match(events[0].trace_id, /^[0-9a-f]{32}$/);
    assert.equal(events[0].parent_id, null, 'a lone process is a root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed carrier is ignored rather than adopted', () => {
  const prev = process.env[TRACEPARENT_ENV];
  process.env[TRACEPARENT_ENV] = 'total garbage';
  try {
    assert.equal(seedFromEnvironment(), false);
  } finally {
    if (prev === undefined) delete process.env[TRACEPARENT_ENV];
    else process.env[TRACEPARENT_ENV] = prev;
  }
});

// -- withTraceparentEnv: the argument-shape logic -------------------------

const TP = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

test('the options bag is added when the caller passed none', () => {
  const out = withTraceparentEnv(['ls', ['-l']], TP);
  assert.equal(out.length, 3);
  assert.equal(out[2].env[TRACEPARENT_ENV], TP);
});

test('an existing options bag is extended, not replaced', () => {
  const out = withTraceparentEnv(['ls', ['-l'], { cwd: '/tmp', env: { A: '1' } }], TP);
  assert.equal(out[2].cwd, '/tmp');
  assert.equal(out[2].env.A, '1');
  assert.equal(out[2].env[TRACEPARENT_ENV], TP);
});

test('the caller options object is not mutated', () => {
  // It may be reused for a later spawn; a leftover traceparent would attach a
  // stale span to an unrelated child.
  const opts = { cwd: '/tmp' };
  withTraceparentEnv(['ls', opts], TP);
  assert.deepEqual(opts, { cwd: '/tmp' });
});

test('a bag is inserted before a trailing callback, not after it', () => {
  const cb = () => {};
  const out = withTraceparentEnv(['echo hi', cb], TP);
  assert.equal(typeof out[out.length - 1], 'function', 'the callback stays last');
  assert.equal(out[1].env[TRACEPARENT_ENV], TP);
});

test('an args array is never mistaken for the options bag', () => {
  const out = withTraceparentEnv(['node', ['-e', 'null']], TP);
  assert.ok(Array.isArray(out[1]), 'the args array is untouched');
  assert.equal(out[2].env[TRACEPARENT_ENV], TP);
});

test('env defaults to process.env so the child keeps its environment', () => {
  const out = withTraceparentEnv(['ls', { cwd: '/tmp' }], TP);
  assert.equal(out[1].env.PATH, process.env.PATH, 'PATH survived');
});

test('currentTraceparent drives what gets injected', async () => {
  await runInSpan(async () => {
    const ctx = getCurrent();
    const out = withTraceparentEnv(['ls'], `00-${ctx.trace_id}-${ctx.span_id}-01`);
    assert.ok(out[1].env[TRACEPARENT_ENV].includes(ctx.trace_id));
  });
});

/**
 * The seeded context must be readable from an async context other than the one
 * that seeded it. It used to live in an AsyncLocalStorage via enterWith(),
 * which only worked because the async_hooks implementation let that leak out
 * of the calling context. Node 24 makes AsyncContextFrame the default and ends
 * the leak, and every worker thread silently started its own root trace: the
 * `--import` bootstrap seeds in one context, the worker's main module runs in
 * another. test-worker-threads.mjs catches it end to end on Node 24 only; this
 * states the invariant on every version.
 */
test('a seeded context survives into a different async context', async () => {
  try {
    assert.equal(seedFromEnvironment(TP), true);
    const seeded = getCurrent();
    assert.ok(seeded, 'seeded synchronously');

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(getCurrent(), seeded, 'still there after the context changed');

    await runInSpan(async () => {
      const span = getCurrent();
      assert.equal(span.trace_id, seeded.trace_id, 'a local span inherits the trace');
      assert.equal(span.depth, 0, 'and lands at depth 0, like an ordinary root');
      assert.notEqual(span.span_id, seeded.span_id, 'the real span wins over the seed');
    });

    assert.deepEqual(getCurrent(), seeded, 'the seed is a fallback, not consumed');
  } finally {
    _clearInheritedContextForTests();
  }
});

test('an unseeded process has no ambient context', () => {
  _clearInheritedContextForTests();
  assert.equal(seedFromEnvironment('not-a-traceparent'), false);
  assert.equal(getCurrent(), null, 'a malformed carrier leaves no seed behind');
});
