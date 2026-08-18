/**
 * End-to-end: the browser capture layer emits, the dashboard collector
 * receives, and valid v2 JSONL lands on disk.
 *
 * Each half is unit-tested on its own, which is exactly why this exists — both
 * can be individually correct and still not fit. The seam has real content:
 * a batch shape, a content type, schema validation on the receiving side, and
 * a file format three other tools read. This is the only test that exercises
 * the browser path as a whole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { resetContext } from '../src/context.js';
import { configure, flush, resetEmitter } from '../src/emitter.js';
import { traceHttp, traceRoute, reportError } from '../src/api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);

/** Boots the real dashboard app against a temp output file. */
async function startCollector() {
  const dir = mkdtempSync(join(tmpdir(), 'ft-browser-e2e-'));
  const out = join(dir, 'flowtrace.jsonl');
  process.env.FLOWTRACE_COLLECTOR_OUTPUT = out;
  // Required before the module is loaded: the output path is read at call time
  // but the app wires its router at import.
  const app = require(join(REPO, 'flowtrace-dashboard', 'server', 'server.js'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, dir, out, port: server.address().port };
}

function readEvents(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('browser spans reach the collector and land as valid JSONL', async () => {
  const { server, dir, out, port } = await startCollector();
  try {
    resetContext();
    resetEmitter();
    configure({
      endpoint: `http://127.0.0.1:${port}/api/trace`,
      batchSize: 10000,       // flush manually, so the assertion is deterministic
      flushIntervalMs: 0,
    });

    await traceHttp({ method: 'GET', url: 'http://api.test/orders/7?token=SECRET' },
      async () => ({ status: 200 }));
    traceRoute({ from: '/home', to: '/orders' }).end();
    reportError(new TypeError('render failed'), 'window.onerror');

    await flush();

    const events = readEvents(out);
    // 2 http + 2 route + 2 error
    assert.equal(events.length, 6, `expected 6 events, got ${events.length}`);

    // The collector validates against schema v2 and drops anything invalid, so
    // arriving at all is the proof that these events satisfy the contract.
    const modules = events.map((e) => e.module);
    assert.deepEqual([...new Set(modules)].sort(), ['error', 'http', 'router']);

    // Every span on one page belongs to one trace, so the tree tools work.
    assert.equal(new Set(events.map((e) => e.trace_id)).size, 1);

    // Enter/exit pairing survived the round trip.
    const enters = events.filter((e) => e.event === 'enter');
    const exits = events.filter((e) => e.event === 'exit');
    assert.equal(enters.length, 3);
    assert.equal(exits.length, 3);
    assert.deepEqual(
      enters.map((e) => e.span_id).sort(),
      exits.map((e) => e.span_id).sort(),
      'every enter has its exit'
    );

    // The secret in the query string must not have been written to disk.
    assert.equal(readFileSync(out, 'utf8').includes('SECRET'), false);

    // The failure is discoverable the same way a server-side one is.
    const failed = exits.filter((e) => e.error);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].error.type, 'TypeError');
    assert.deepEqual(failed[0].result, {}, 'result is required even on the error branch');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the collector rejects a malformed browser event instead of writing it', async () => {
  const { server, dir, out, port } = await startCollector();
  try {
    // Simulates a future emitter bug: an event missing required fields. The
    // collector is the last line of defence for the trace file's integrity.
    const res = await fetch(`http://127.0.0.1:${port}/api/trace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ event: 'enter', module: 'http' }]),
    });
    const body = await res.json();
    assert.equal(body.accepted, 0);
    assert.equal(body.rejected.length, 1);
    assert.equal(readEvents(out).length, 0, 'nothing invalid reached the file');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
