/**
 * Durability regression tests for the emitter.
 *
 * The emitter used to queue asynchronous writes and settle them on 'beforeExit',
 * which does not fire when the traced app calls process.exit() — the normal way
 * a CLI or a server with a graceful shutdown stops. Events still in flight were
 * lost silently.
 *
 * The first repair (async queue + a synchronous 'exit' handler for whatever was
 * left) traded loss for duplication: between the OS completing a write and its
 * continuation running, the line is on disk but still marked pending, and
 * process.exit() runs 'exit' handlers without draining microtasks.
 *
 * Both failure modes are asserted here, in a real child process, because
 * neither reproduces in-process.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMITTER = pathToFileURL(join(__dirname, '../src/runtime/emitter.js')).href;

const EVENT_COUNT = 50;

/**
 * Run a child that emits EVENT_COUNT events and then stops in the given way.
 * @param {'process.exit'|'natural'} ending
 */
function runChild(ending) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-exit-'));
  const outPath = join(dir, 'trace.jsonl');
  const scriptPath = join(dir, 'child.mjs');

  writeFileSync(
    scriptPath,
    `
import { emit, init } from ${JSON.stringify(EMITTER)};
init(${JSON.stringify(outPath)});

for (let i = 0; i < ${EVENT_COUNT}; i += 1) {
  emit({
    ts: 1700000000 + i / 1000,
    trace_id: 'f10c17ace000000000000000000000a1',
    span_id: i.toString(16).padStart(16, '0'),
    parent_id: null,
    event: 'enter',
    thread: 'main',
    lang: 'node',
    module: 'child',
    class: '',
    method: 'm' + i,
    visibility: 'public',
    args: {},
    depth: 0,
  });
}
${ending === 'process.exit' ? 'process.exit(0);' : ''}
`,
    'utf8'
  );

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  return { dir, outPath, result };
}

function readEvents(outPath) {
  assert.ok(existsSync(outPath), `expected trace at ${outPath}`);
  return readFileSync(outPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

test('process.exit() loses no events', () => {
  const { dir, outPath, result } = runChild('process.exit');
  try {
    assert.equal(result.status, 0, `child failed:\n${result.stderr}`);
    const lines = readEvents(outPath);
    assert.equal(
      lines.length,
      EVENT_COUNT,
      `expected ${EVENT_COUNT} events after process.exit(), got ${lines.length}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process.exit() duplicates no events', () => {
  const { dir, outPath, result } = runChild('process.exit');
  try {
    assert.equal(result.status, 0, `child failed:\n${result.stderr}`);
    const lines = readEvents(outPath);
    assert.equal(new Set(lines).size, lines.length, 'every emitted line must appear exactly once');

    // Ordering is part of the contract too — a trace read out of order is a
    // different call tree.
    const methods = lines.map((l) => JSON.parse(l).method);
    assert.deepEqual(
      methods,
      Array.from({ length: EVENT_COUNT }, (_, i) => `m${i}`),
      'events must be written in emission order'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a natural exit writes the same trace as process.exit()', () => {
  const viaExit = runChild('process.exit');
  const natural = runChild('natural');
  try {
    assert.equal(viaExit.result.status, 0, viaExit.result.stderr);
    assert.equal(natural.result.status, 0, natural.result.stderr);
    assert.deepEqual(
      readEvents(viaExit.outPath),
      readEvents(natural.outPath),
      'how the process ends must not change the trace'
    );
  } finally {
    rmSync(viaExit.dir, { recursive: true, force: true });
    rmSync(natural.dir, { recursive: true, force: true });
  }
});
