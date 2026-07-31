/**
 * Cross-boundary propagation integration tests.
 *
 * These are the tests that actually prove the feature: a trace_id must survive
 * a process boundary (env carrier) and a network boundary (HTTP header), so
 * that two separately-traced programs produce ONE tree rather than two.
 *
 * Both tests spawn real processes with the real bootstrap and assert against
 * the emitted JSONL — nothing is stubbed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');
const FIXTURES = join(__dirname, 'fixtures/propagation');
const CALCULATOR = join(__dirname, '../../../examples/golden/node/calculator.js');

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

function baseEnv(outPath, extra = {}) {
  return {
    ...process.env,
    FLOWTRACE_OUTPUT: outPath,
    FLOWTRACE_PACKAGE_PREFIX: '',
    NODE_OPTIONS: '', // clear so the child does not double-import the bootstrap
    ...extra,
  };
}

/** Read a JSONL trace file into parsed events. */
function readEvents(path) {
  assert.ok(existsSync(path), `expected trace output at ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function makeOutDir(tag) {
  const dir = join(tmpdir(), `ft-prop-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('env carrier: a seeded child continues the parent trace', () => {
  const outDir = makeOutDir('env');
  const outPath = join(outDir, 'trace.jsonl');

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', `file://${BOOTSTRAP}`, CALCULATOR],
      {
        env: baseEnv(outPath, { FLOWTRACE_TRACEPARENT: `00-${TRACE}-${SPAN}-01` }),
        cwd: dirname(CALCULATOR),
        timeout: 20000,
        encoding: 'utf8',
      }
    );

    const events = readEvents(outPath);
    assert.ok(events.length > 0, `expected events, got none. stderr:\n${result.stderr}`);

    // Every span must belong to the seeded trace, not a freshly minted one.
    const traceIds = new Set(events.map((e) => e.trace_id));
    assert.deepEqual([...traceIds], [TRACE], 'all events should carry the seeded trace_id');

    // The local root must hang off the remote span, and must still be depth 0
    // (the synthetic parent's depth of -1 exists precisely for this).
    const roots = events.filter((e) => e.depth === 0 && e.event === 'enter');
    assert.ok(roots.length > 0, 'expected at least one depth-0 enter event');
    for (const root of roots) {
      assert.equal(root.parent_id, SPAN, 'seeded root should point at the remote span_id');
    }

    // No event may violate the schema's depth >= 0 constraint.
    for (const e of events) {
      assert.ok(e.depth >= 0, `depth must be >= 0, got ${e.depth}`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('env carrier: an unseeded child mints its own trace', () => {
  const outDir = makeOutDir('noseed');
  const outPath = join(outDir, 'trace.jsonl');

  try {
    spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, CALCULATOR], {
      env: baseEnv(outPath), // no FLOWTRACE_TRACEPARENT
      cwd: dirname(CALCULATOR),
      timeout: 20000,
      encoding: 'utf8',
    });

    const events = readEvents(outPath);
    assert.ok(events.length > 0);
    // Regression guard: seeding must not leak in when the carrier is absent.
    assert.notEqual(events[0].trace_id, TRACE);
    const roots = events.filter((e) => e.depth === 0 && e.event === 'enter');
    for (const root of roots) {
      assert.equal(root.parent_id, null, 'an unseeded root has no parent');
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('env carrier: a malformed carrier is ignored, not propagated', () => {
  const outDir = makeOutDir('badseed');
  const outPath = join(outDir, 'trace.jsonl');

  try {
    spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, CALCULATOR], {
      env: baseEnv(outPath, { FLOWTRACE_TRACEPARENT: 'total-garbage' }),
      cwd: dirname(CALCULATOR),
      timeout: 20000,
      encoding: 'utf8',
    });

    // Must still produce a valid, self-consistent trace rather than dropping
    // events or emitting an invalid trace_id.
    const events = readEvents(outPath);
    assert.ok(events.length > 0, 'a bad carrier must not suppress tracing');
    assert.match(events[0].trace_id, /^[0-9a-f]{32}$/);
    for (const e of events) {
      assert.ok(e.depth >= 0);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('HTTP carrier: client and server land in one trace', async () => {
  const outDir = makeOutDir('http');
  const serverOut = join(outDir, 'server.jsonl');
  const clientOut = join(outDir, 'client.jsonl');

  let server;
  try {
    // ── Start the instrumented server and wait for its port ──
    server = spawn(
      process.execPath,
      ['--import', `file://${BOOTSTRAP}`, join(FIXTURES, 'server.mjs')],
      { env: baseEnv(serverOut), cwd: FIXTURES, encoding: 'utf8' }
    );

    let serverStderr = '';
    server.stderr.setEncoding('utf8');
    server.stderr.on('data', (d) => { serverStderr += d; });

    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`server never reported READY. stderr:\n${serverStderr}`)),
        20000
      );
      let buf = '';
      server.stdout.setEncoding('utf8');
      server.stdout.on('data', (chunk) => {
        buf += chunk;
        const match = buf.match(/READY (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      server.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early (${code}). stderr:\n${serverStderr}`));
      });
    });

    // ── Run the instrumented client against it ──
    const client = spawnSync(
      process.execPath,
      ['--import', `file://${BOOTSTRAP}`, join(FIXTURES, 'client.mjs'), String(port)],
      { env: baseEnv(clientOut), cwd: FIXTURES, timeout: 20000, encoding: 'utf8' }
    );
    assert.match(
      client.stdout ?? '',
      /GOT hello world/,
      `client did not get a response. stderr:\n${client.stderr}`
    );

    // The server closes itself after one request; wait for a clean exit so its
    // beforeExit flush has completed before we read the log.
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.on('exit', resolve);
    });

    // ── Assert one trace spans both processes ──
    const clientEvents = readEvents(clientOut);
    const serverEvents = readEvents(serverOut);
    assert.ok(clientEvents.length > 0, 'client emitted no events');
    assert.ok(serverEvents.length > 0, 'server emitted no events');

    // Each process legitimately emits more than one trace: the client's
    // .then() callback and the server's listen() callback each run outside any
    // span and so start their own root. What must hold is that the span which
    // *made* the call and the spans which *served* it share one trace.
    const callSpan = clientEvents.find(
      (e) => e.event === 'enter' && e.method === 'fetchGreeting'
    );
    assert.ok(callSpan, 'expected an instrumented fetchGreeting span on the client');

    const servedInCallTrace = serverEvents.filter((e) => e.trace_id === callSpan.trace_id);
    assert.ok(
      servedInCallTrace.length > 0,
      'server emitted nothing in the client trace — the header did not propagate'
    );

    // The server's root span must be parented to the exact client span that
    // issued the request. This is the link that makes the tree connect.
    const serverRoot = servedInCallTrace.find(
      (e) => e.event === 'enter' && e.parent_id === callSpan.span_id
    );
    assert.ok(
      serverRoot,
      `no server span is parented to the calling span ${callSpan.span_id}`
    );
    assert.equal(serverRoot.depth, 0, 'the seeded server root must be depth 0');

    // ...and the handler's own work must nest under that root.
    const greeting = servedInCallTrace.find(
      (e) => e.event === 'enter' && e.method === 'buildGreeting'
    );
    assert.ok(greeting, 'expected buildGreeting to be traced in the joined trace');
    assert.equal(greeting.parent_id, serverRoot.span_id);
    assert.equal(greeting.depth, 1);

    for (const e of [...clientEvents, ...serverEvents]) {
      assert.ok(e.depth >= 0, `depth must be >= 0, got ${e.depth}`);
    }
  } finally {
    if (server && server.exitCode === null) server.kill('SIGKILL');
    rmSync(outDir, { recursive: true, force: true });
  }
});
