/**
 * The `thread` field must identify the thread that actually produced the event.
 *
 * It was hardcoded to the literal 'main' in all three emit sites, which was
 * actively wrong rather than imprecise: bootstrap.mjs deliberately propagates
 * instrumentation into worker_threads via NODE_OPTIONS, so worker events were
 * emitted claiming to be on the main thread. A multi-threaded trace could not be
 * untangled at all, and nothing in the output hinted that the value was fake.
 *
 * Node was also the only layer not reporting a real thread — Python uses
 * threading.current_thread().name, Java uses the JVM thread name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');
const FIXTURES = join(__dirname, 'fixtures/threads');

function run(entry) {
  const outDir = join(
    tmpdir(),
    `ft-threads-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');

  try {
    // NODE_OPTIONS is deliberately NOT cleared here: the bootstrap sets it so
    // that worker threads inherit instrumentation, and that inheritance is
    // exactly what this test exercises.
    const result = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, entry], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '',
      },
      cwd: FIXTURES,
      timeout: 30000,
      encoding: 'utf8',
    });

    const events = existsSync(outPath)
      ? readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    return { ...result, events };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test('worker thread events are not labelled as the main thread', () => {
  const { stdout, stderr, events } = run('main.mjs');

  assert.match(stdout ?? '', /worker exited/, `worker never ran. stderr:\n${stderr}`);
  assert.ok(events.length > 0, 'no events emitted');

  const mainWork = events.find((e) => e.method === 'mainWork' && e.event === 'enter');
  const workerWork = events.find((e) => e.method === 'workerWork' && e.event === 'enter');

  assert.ok(mainWork, 'main-thread function was not traced');
  assert.ok(
    workerWork,
    'worker function was not traced — NODE_OPTIONS propagation into the worker is broken'
  );

  assert.equal(mainWork.thread, 'main');
  assert.notEqual(
    workerWork.thread,
    'main',
    'worker event claims to be on the main thread — the regression this test exists for'
  );
  assert.match(workerWork.thread, /^worker-\d+$/, `unexpected thread label: ${workerWork.thread}`);
});

test('every event reports a non-empty thread the schema accepts', () => {
  const { events } = run('main.mjs');
  for (const e of events) {
    assert.equal(typeof e.thread, 'string');
    assert.ok(e.thread.length > 0, 'thread must not be empty');
  }
});

test('main and worker events are distinguishable from one another', () => {
  // The practical consequence: a consumer grouping by thread must see two
  // groups, not one. With the hardcoded value it saw exactly one.
  const { events } = run('main.mjs');
  const threads = new Set(events.map((e) => e.thread));
  assert.ok(
    threads.size >= 2,
    `expected at least 2 distinct threads, got ${[...threads].join(', ')}`
  );
});
