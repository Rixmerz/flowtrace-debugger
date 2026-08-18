/**
 * Tests for the trace collector (POST /api/trace).
 *
 * Runs the real Express app against a real socket and a real temp file. The
 * endpoint's whole job is turning untrusted network input into bytes on disk,
 * so the parts worth testing are the ones that decide what never reaches the
 * disk — mocking those away would test nothing.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let server;
let baseUrl;
let outFile;
let tmpDir;

/** A schema-valid v2 enter event. */
function enterEvent(over = {}) {
  return {
    ts: 1700000000.5,
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    parent_id: null,
    event: 'enter',
    thread: 'main',
    lang: 'node',
    module: 'app',
    class: '',
    method: 'handler',
    visibility: 'public',
    args: {},
    depth: 0,
    ...over,
  };
}

function post(body, contentType = 'application/json') {
  return fetch(`${baseUrl}/api/trace`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function written() {
  if (!fs.existsSync(outFile)) return [];
  return fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// -- happy path ------------------------------------------------------------

test('accepts a batch and appends it as JSONL', async () => {
  const res = await post({ events: [enterEvent(), enterEvent({ method: 'other' })] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, 2);
  assert.deepEqual(body.rejected, []);
  const rows = written();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].method, 'other');
});

test('accepts a bare array as well as {events}', async () => {
  const before = written().length;
  const res = await post([enterEvent({ method: 'bare' })]);
  assert.equal((await res.json()).accepted, 1);
  assert.equal(written().length, before + 1);
});

test('appends across requests rather than truncating', async () => {
  const before = written().length;
  await post([enterEvent()]);
  await post([enterEvent()]);
  assert.equal(written().length, before + 2);
});

test('accepts text/plain, which is what sendBeacon sends', async () => {
  // A beacon posts a Blob typed text/plain to dodge the CORS preflight. If the
  // server only parsed application/json this body would arrive empty, and the
  // events lost would be the unload ones — the tail of the session.
  const before = written().length;
  const res = await post(JSON.stringify([enterEvent({ method: 'beacon' })]), 'text/plain');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).accepted, 1);
  assert.equal(written()[written().length - 1].method, 'beacon');
  assert.equal(written().length, before + 1);
});

// -- validation: nothing invalid reaches the disk --------------------------

test('rejects an event that fails schema v2 and does not write it', async () => {
  const before = written().length;
  const res = await post([{ event: 'enter', nonsense: true }]);
  const body = await res.json();
  assert.equal(body.accepted, 0);
  assert.equal(body.rejected.length, 1);
  assert.equal(body.rejected[0].index, 0);
  assert.ok(body.rejected[0].reason.length > 0, 'the rejection says why');
  assert.equal(written().length, before, 'nothing was appended');
});

test('a bad trace_id is rejected, not coerced', async () => {
  const before = written().length;
  const res = await post([enterEvent({ trace_id: 'NOT-HEX' })]);
  assert.equal((await res.json()).accepted, 0);
  assert.equal(written().length, before);
});

test('an exit without result is rejected — the schema requires it', async () => {
  const bad = enterEvent({ event: 'exit', duration_ns: 5 });
  delete bad.result;
  const res = await post([bad]);
  assert.equal((await res.json()).accepted, 0);
});

test('a mixed batch writes only the valid events and reports the rest', async () => {
  const before = written().length;
  const res = await post([enterEvent({ method: 'good1' }), { junk: 1 }, enterEvent({ method: 'good2' })]);
  const body = await res.json();
  assert.equal(body.accepted, 2);
  assert.deepEqual(body.rejected.map((r) => r.index), [1]);
  const rows = written();
  assert.equal(rows.length, before + 2);
  assert.deepEqual(rows.slice(-2).map((r) => r.method), ['good1', 'good2']);
});

// -- malformed input -------------------------------------------------------

test('non-JSON body is a 400, not a crash', async () => {
  const res = await post('this is not json', 'text/plain');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not JSON/);
});

test('an object that is not a batch is a 400', async () => {
  const res = await post({ hello: 'world' });
  assert.equal(res.status, 400);
});

test('an empty body is a 400', async () => {
  const res = await post('', 'text/plain');
  assert.equal(res.status, 400);
});

test('an empty batch is accepted as a no-op', async () => {
  const before = written().length;
  const res = await post([]);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).accepted, 0);
  assert.equal(written().length, before);
});

// -- limits ----------------------------------------------------------------

test('too many events is refused by count, and writes nothing', async () => {
  // Deliberately small events so this trips the event-count cap rather than the
  // byte cap — otherwise the test passes for the wrong reason and MAX_EVENTS
  // goes unexercised. 1001 minimal events stay well under the 1 MB body limit.
  const before = written().length;
  const many = Array.from({ length: 1001 }, () => enterEvent());
  const res = await post(many);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /exceeds the limit of 1000 events/);
  assert.equal(written().length, before, 'the whole batch was refused before any write');
});

test('an oversized body is refused as JSON, not an HTML stack trace', async () => {
  const before = written().length;
  // One event carrying ~2 MB of argument data: over the body limit, under the
  // event-count one.
  const fat = enterEvent({ args: { blob: 'x'.repeat(2 * 1024 * 1024) } });
  const res = await post([fat]);
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /body exceeds/);
  assert.equal(written().length, before);
});

// -- the destination is not caller-controlled ------------------------------

test('the request cannot redirect where events are written', async () => {
  // Path traversal is the obvious attempt: if any request field influenced the
  // output path, this would land outside the temp dir.
  const escape = path.join(tmpDir, '..', 'ESCAPED.jsonl');
  const before = written().length;
  const res = await post({
    output: escape, path: escape, file: escape,
    events: [enterEvent({ method: 'traversal' })],
  });
  assert.equal(res.status, 200);
  assert.equal(written().length, before + 1, 'it went to the configured file');
  assert.equal(fs.existsSync(escape), false, 'nothing was written outside it');
});

test('config endpoint reports the limits and the server-side destination', async () => {
  const res = await fetch(`${baseUrl}/api/trace/config`);
  const cfg = await res.json();
  assert.equal(cfg.maxEvents, 1000);
  assert.equal(cfg.output, outFile);
});

// -- runner ----------------------------------------------------------------

async function main() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-collect-'));
  outFile = path.join(tmpDir, 'flowtrace.jsonl');
  process.env.FLOWTRACE_COLLECTOR_OUTPUT = outFile;

  // Required before the app module is loaded: outputPath() reads the env var.
  const app = require('../server/server.js');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); pass++; }
    catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);

  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main();
