/**
 * Proves that a worker_thread (a) is labelled as one and (b) joins the trace
 * of the span that created it.
 *
 * Workers inherit NODE_OPTIONS, so they were always instrumented — but
 * AsyncLocalStorage does not cross the thread boundary, so every worker
 * started an unrelated root trace while claiming `thread: "main"`.
 *
 * Runs with: node --test test/test-worker-threads.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const BOOTSTRAP = join(PKG, 'src', 'bootstrap.mjs');
const PARENT = join(HERE, 'fixtures', 'worker-parent.mjs');

test('a worker thread is labelled and lands in the creating span', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-worker-'));
  const out = join(dir, 'trace.jsonl');
  const res = spawnSync(process.execPath, ['--import', BOOTSTRAP, PARENT], {
    cwd: PKG, // fixtures are under cwd, so the default prefix instruments them
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, FLOWTRACE_OUTPUT: out, NODE_OPTIONS: '' },
  });
  const events = existsSync(out)
    ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  rmSync(dir, { recursive: true, force: true });

  assert.equal(res.status, 0, `fixture failed: ${res.stderr}`);

  const parent = events.find((e) => e.event === 'enter' && e.method === 'startWorker');
  const child = events.find((e) => e.event === 'enter' && e.method === 'work');
  assert.ok(parent, `no startWorker span in ${JSON.stringify(events)}`);
  assert.ok(child, `no work span in ${JSON.stringify(events)}`);

  assert.equal(parent.thread, 'main');
  assert.match(child.thread, /^worker-\d+$/);

  assert.equal(child.trace_id, parent.trace_id, 'the worker adopted the creating trace');
  assert.equal(child.parent_id, parent.span_id, 'the worker root hangs off startWorker');
  assert.equal(child.depth, 0, 'a worker root is a local root, like a child process');
  assert.deepEqual(child.args, { n: 21 });
});
