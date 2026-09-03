/**
 * log_aggregate and log_open against a real file, through the built dist/.
 *
 * The aggregate path had no test at all, which is how `Math.max(...vals)`
 * shipped: the spread turns a group into an argument list, so the operator
 * threw RangeError on exactly the traces anyone would run it on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function event(i, { method = 'work', duration = i, module_ = 'm' } = {}) {
  const span = i.toString(16).padStart(16, '0');
  return {
    ts: 1700000000 + i / 1000,
    trace_id: 'a'.repeat(32),
    span_id: span,
    parent_id: null,
    event: 'exit',
    thread: 'main',
    lang: 'node',
    module: module_,
    class: '',
    method,
    visibility: 'public',
    args: {},
    result: {},
    duration_ns: duration,
    depth: 0,
  };
}

let dir;
/** Writes a JSONL file and returns its path. */
function writeLog(name, events) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

/**
 * Drives the server over its real stdio transport: these tools are only
 * reachable that way, and a test that imported the module directly would not
 * exercise the protocol layer where the arguments are validated.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));

/** One stdio MCP session: initialize, then call tools in order. */
async function withSession(calls, env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const responses = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses.set(msg.id, msg);
      } catch { /* not a protocol line */ }
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString(); });

  let nextId = 1;
  const send = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return id;
  };
  const wait = async (id, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (responses.has(id)) return responses.get(id);
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for response ${id}; stderr:\n${stderr}`);
  };

  await wait(send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  }));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const out = [];
  try {
    for (const { name, args } of calls) {
      const res = await wait(send('tools/call', { name, arguments: args(out) }));
      out.push(res.result);
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
  return out;
}

/** The JSON payload a tool returned, or the error text. */
function payload(result) {
  const text = result?.content?.[0]?.text ?? '';
  if (result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { error: text }; }
}

// ---------------------------------------------------------------------------

test('max/min over a group larger than the call-stack limit', async () => {
  // 200k rows in one group: Math.max(...vals) throws RangeError well below this.
  const events = [];
  for (let i = 1; i <= 200000; i++) events.push(event(i, { duration: i }));
  const file = writeLog('big.jsonl', events);

  const [open, max, min, sum, avg, count] = await withSession([
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'max', field: 'duration_ns' } }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'min', field: 'duration_ns' } }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'sum', field: 'duration_ns' } }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'avg', field: 'duration_ns' } }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'count' } }) },
  ]);

  assert.equal(payload(open).count, 200000);
  assert.equal(payload(max).groups[0].value, 200000, 'max over 200k values');
  assert.equal(payload(min).groups[0].value, 1);
  assert.equal(payload(sum).groups[0].value, (200000 * 200001) / 2);
  assert.equal(payload(avg).groups[0].value, 100000.5);
  assert.equal(payload(count).groups[0].value, 200000);
});

test('groups are paged, ordered and countable', async () => {
  const events = [];
  for (let i = 1; i <= 30; i++) events.push(event(i, { method: `m${i}`, duration: i }));
  const file = writeLog('groups.jsonl', events);

  const [, first, second] = await withSession([
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'sum', field: 'duration_ns' }, limit: 10 }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['method'], metric: { op: 'sum', field: 'duration_ns' }, limit: 10, offset: 10 }) },
  ]);

  const a = payload(first);
  const b = payload(second);
  assert.equal(a.total, 30);
  assert.equal(a.returned, 10);
  assert.equal(a.truncated, true);
  assert.equal(a.groups[0].value, 30, 'ordered by value, descending');
  assert.equal(b.offset, 10);
  const overlap = a.groups.filter((g) => b.groups.some((h) => h.key === g.key));
  assert.equal(overlap.length, 0, 'pages do not repeat a group');
});

test('an unknown field is an error naming the real ones, not a column of nulls', async () => {
  const file = writeLog('fields.jsonl', [event(1)]);
  const [, agg, search] = await withSession([
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'log_aggregate', args: (o) => ({ sessionId: payload(o[0]).sessionId, groupBy: ['methdo'], metric: { op: 'count' } }) },
    { name: 'log_search', args: (o) => ({ sessionId: payload(o[0]).sessionId, fields: ['durationms'] }) },
  ]);
  assert.match(payload(agg).error, /Unknown groupBy field/);
  assert.match(payload(agg).error, /method/);
  assert.match(payload(search).error, /Unknown field/);
});

test('log_open refuses a directory, a missing path and an oversized file', async () => {
  const file = writeLog('small.jsonl', [event(1)]);
  const [dirRes, missingRes, bigRes, okRes] = await withSession([
    { name: 'log_open', args: () => ({ path: dir }) },
    { name: 'log_open', args: () => ({ path: path.join(dir, 'nope.jsonl') }) },
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'log_open', args: () => ({ path: file }) },
  ], { FLOWTRACE_MCP_MAX_BYTES: '10' });

  assert.match(payload(dirRes).error, /is a directory/);
  assert.match(payload(missingRes).error, /File not found/);
  assert.match(payload(bigRes).error, /FLOWTRACE_MCP_MAX_BYTES/);
  assert.match(payload(okRes).error, /over the/, 'the cap applies to every open');
});

test('log_open reports size and field names; log_schema describes the log', async () => {
  const file = writeLog('schema.jsonl', [event(1), event(2)]);
  const [open, schema] = await withSession([
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'log_schema', args: (o) => ({ sessionId: payload(o[0]).sessionId }) },
  ]);
  const o = payload(open);
  assert.equal(o.count, 2);
  assert.ok(o.bytes > 0);
  assert.ok(o.fields.includes('duration_ns'));
  const s = payload(schema);
  assert.equal(s.schemaVersion, 'v2');
  assert.equal(s.fields.duration_ns, 2);
  assert.equal(s.sampleRow.method, 'work');
});

test('a v1 log opens, is labelled v1, and v2 tools return empty rather than lying', async () => {
  const v1 = { timestamp: Date.now(), event: 'ENTER', class: 'C', method: 'm', durationMicros: 5 };
  const file = writeLog('v1.jsonl', [v1, v1]);
  const [open, tree, priv] = await withSession([
    { name: 'log_open', args: () => ({ path: file }) },
    { name: 'trace_tree', args: (o) => ({ sessionId: payload(o[0]).sessionId, trace_id: 'a'.repeat(32) }) },
    { name: 'trace_private_calls', args: (o) => ({ sessionId: payload(o[0]).sessionId }) },
  ]);
  const o = payload(open);
  assert.equal(o.schemaVersion, 'v1');
  assert.equal(o.count, 0, 'v1 rows are not loaded as v2 events');
  assert.deepEqual(payload(tree).roots, []);
  assert.deepEqual(payload(priv).private_calls, []);
});

// ---------------------------------------------------------------------------

async function main() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mcp-agg-'));
  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); pass++; }
    catch (e) { console.error(`  FAIL ${name}\n        ${e.stack}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main();
