/**
 * Proves the whole point of traceparent propagation: two separate OS
 * processes, talking over a real HTTP connection, land in ONE trace tree.
 *
 * This cannot be a golden fixture — the golden normalizer rewrites every
 * trace_id to a single canonical constant, so a fixture would look identical
 * whether or not correlation actually happened. The property only exists in
 * the raw ids, so it has to be asserted here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, 'fixtures', 'xproc-server.mjs');
const CLIENT = join(HERE, 'fixtures', 'xproc-client.mjs');

/** Reads a JSONL trace file into parsed events. */
function readTrace(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Spawns the server and resolves once it reports its port. */
function startServer(outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      env: { ...process.env, FLOWTRACE_OUTPUT: outPath },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (chunk) => {
      const m = /PORT (\d+)/.exec(chunk.toString());
      if (m) {
        clearTimeout(timer);
        resolve({ proc, port: Number(m[1]) });
      }
    });
    proc.on('error', reject);
  });
}

/** Runs the client against `port` and resolves on clean exit. */
function runClient(port, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLIENT, String(port)], {
      env: { ...process.env, FLOWTRACE_OUTPUT: outPath },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`client exited ${code}`))
    );
    proc.on('error', reject);
  });
}

/** Waits for the server to flush and exit after SIGTERM. */
function stopServer(proc) {
  return new Promise((resolve) => {
    proc.on('exit', resolve);
    proc.kill('SIGTERM');
  });
}

test('a trace survives an HTTP hop between two processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-xproc-'));
  const clientOut = join(dir, 'client.jsonl');
  const serverOut = join(dir, 'server.jsonl');

  try {
    const { proc, port } = await startServer(serverOut);
    await runClient(port, clientOut);
    await stopServer(proc);

    const clientEvents = readTrace(clientOut);
    const serverEvents = readTrace(serverOut);

    assert.equal(clientEvents.length, 1, 'client emitted its root span');
    assert.equal(serverEvents.length, 1, 'server emitted its handler span');

    const client = clientEvents[0];
    const server = serverEvents[0];

    // The whole point: one trace_id across both processes.
    assert.equal(
      server.trace_id,
      client.trace_id,
      'server adopted the client trace_id instead of minting its own'
    );

    // And the server's span hangs off the client's span, so the two halves
    // form a single tree rather than two disconnected roots.
    assert.equal(
      server.parent_id,
      client.span_id,
      "server span's parent is the client span"
    );

    // The server span is a child, not a second root.
    assert.equal(client.parent_id, null);
    assert.equal(client.depth, 0);
    assert.equal(server.depth, 0, 'first local span on the server sits at depth 0');

    // Ids stay schema-valid after crossing the wire.
    assert.match(server.trace_id, /^[0-9a-f]{32}$/);
    assert.match(server.parent_id, /^[0-9a-f]{16}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a request with no traceparent still traces, as its own root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-xproc-'));
  const serverOut = join(dir, 'server.jsonl');

  try {
    const { proc, port } = await startServer(serverOut);
    // Deliberately no traceparent header — an uninstrumented caller.
    await fetch(`http://127.0.0.1:${port}/`);
    await stopServer(proc);

    const events = readTrace(serverOut);
    assert.equal(events.length, 1);
    // Falls back to a fresh local root rather than dropping the span.
    assert.match(events[0].trace_id, /^[0-9a-f]{32}$/);
    assert.equal(events[0].depth, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
