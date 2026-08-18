// End-to-end tests for session lifecycle: LRU eviction, log_close, and the
// paging metadata on log_search.
//
// These drive the real server over stdio rather than unit-testing a helper,
// because the session Map lives in server.ts and the behaviour under test is
// what happens across a *sequence* of tool calls. The client is interactive —
// it waits for each reply before sending the next request — because session
// ids are minted per process, so a test cannot know them in advance.
//
// Run with: node test/test-sessions.mjs (after `pnpm run build`).

import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER = path.join(__dirname, '..', 'dist', 'server.js');
const LOG = path.join(REPO_ROOT, 'examples/golden/java/expected.jsonl');
const ERR_LOG = path.join(REPO_ROOT, 'examples/golden/error/python/expected.jsonl');

/** A live MCP server you can send requests to one at a time. */
class Client {
  constructor(env = {}) {
    this.proc = spawn(process.execPath, [SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const resolve = this.pending.get(msg.id);
        if (resolve) { this.pending.delete(msg.id); resolve(msg); }
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return promise;
  }

  async init() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return this;
  }

  /** Calls a tool and returns its decoded JSON payload; throws on tool error. */
  async call(name, args) {
    const msg = await this.send('tools/call', { name, arguments: args });
    if (msg.error) throw new Error(`${name}: ${msg.error.message}`);
    const text = msg.result.content[0].text;
    if (msg.result.isError) throw new Error(`${name}: ${text}`);
    return JSON.parse(text);
  }

  /** Calls a tool expecting failure; returns the error text. */
  async callExpectingError(name, args) {
    try {
      await this.call(name, args);
    } catch (e) {
      return e.message;
    }
    throw new Error(`${name} unexpectedly succeeded`);
  }

  close() { this.proc.kill('SIGKILL'); }
}

async function withClient(env, fn) {
  const c = await new Client(env).init();
  try { return await fn(c); } finally { c.close(); }
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// -- eviction --------------------------------------------------------------

test('sessions beyond the cap are evicted, oldest first', async () => {
  await withClient({ FLOWTRACE_MCP_MAX_SESSIONS: '2' }, async (c) => {
    const a = await c.call('log_open', { path: LOG });
    const b = await c.call('log_open', { path: ERR_LOG });
    const third = await c.call('log_open', { path: LOG });
    assert.deepEqual(third.evictedSessions, [a.sessionId], 'the oldest session was dropped');
    // The survivor still works.
    const schema = await c.call('log_schema', { sessionId: b.sessionId });
    assert.equal(schema.schemaVersion, 'v2');
  });
});

test('using a session refreshes it, so the untouched one is evicted instead', async () => {
  await withClient({ FLOWTRACE_MCP_MAX_SESSIONS: '2' }, async (c) => {
    const a = await c.call('log_open', { path: LOG });
    const b = await c.call('log_open', { path: ERR_LOG });
    // Touch A. By insertion order A is oldest; by *use* it is now newest.
    await c.call('log_schema', { sessionId: a.sessionId });
    const third = await c.call('log_open', { path: LOG });
    assert.deepEqual(third.evictedSessions, [b.sessionId],
      'LRU dropped the untouched session, not merely the first-opened one');
    // A survived precisely because it was used.
    await c.call('log_schema', { sessionId: a.sessionId });
  });
});

test('an evicted session says so instead of just "invalid"', async () => {
  await withClient({ FLOWTRACE_MCP_MAX_SESSIONS: '1' }, async (c) => {
    const a = await c.call('log_open', { path: LOG });
    await c.call('log_open', { path: ERR_LOG });   // evicts a
    const err = await c.callExpectingError('log_schema', { sessionId: a.sessionId });
    assert.match(err, /evicted/i);
    assert.match(err, /log_open/, 'the error says how to recover');
  });
});

test('a never-issued id is reported as invalid, not as evicted', async () => {
  await withClient({}, async (c) => {
    const err = await c.callExpectingError('log_schema', { sessionId: 'neverexisted' });
    assert.match(err, /Invalid sessionId/);
  });
});

test('the default cap holds several sessions open at once', async () => {
  await withClient({}, async (c) => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await c.call('log_open', { path: LOG })).sessionId);
    // All five must still be usable under the default cap of 8.
    for (const id of ids) await c.call('log_schema', { sessionId: id });
  });
});

// -- log_close -------------------------------------------------------------

test('log_close frees a session and it stops working', async () => {
  await withClient({}, async (c) => {
    const a = await c.call('log_open', { path: LOG });
    const closed = await c.call('log_close', { sessionId: a.sessionId });
    assert.equal(closed.closed, true);
    assert.equal(closed.openSessions, 0);
    const err = await c.callExpectingError('log_schema', { sessionId: a.sessionId });
    assert.match(err, /Invalid sessionId/);
  });
});

test('closing an unknown id reports false rather than throwing', async () => {
  await withClient({}, async (c) => {
    const r = await c.call('log_close', { sessionId: 'nope' });
    assert.equal(r.closed, false);
  });
});

// -- search paging ---------------------------------------------------------

test('log_search reports the true match count, not just the page size', async () => {
  await withClient({}, async (c) => {
    const s = await c.call('log_open', { path: LOG });
    const r = await c.call('log_search', { sessionId: s.sessionId, limit: 2 });
    assert.equal(r.returned, 2);
    assert.equal(r.total, s.count, 'total counts every match, not the page');
    assert.equal(r.truncated, true, 'caller is told it is seeing a fragment');
  });
});

test('paging covers the match set without overlap or gaps', async () => {
  await withClient({}, async (c) => {
    const s = await c.call('log_open', { path: LOG });
    const fields = ['span_id', 'event'];
    const p1 = await c.call('log_search', { sessionId: s.sessionId, limit: 3, offset: 0, fields });
    const p2 = await c.call('log_search', { sessionId: s.sessionId, limit: 3, offset: 3, fields });
    const all = await c.call('log_search', { sessionId: s.sessionId, fields });
    assert.deepEqual([...p1.rows, ...p2.rows], all.rows.slice(0, 6));
    assert.equal(p2.offset, 3);
    assert.equal(all.truncated, false, 'a full page is not marked truncated');
  });
});

test('an offset past the end yields no rows and does not error', async () => {
  await withClient({}, async (c) => {
    const s = await c.call('log_open', { path: LOG });
    const r = await c.call('log_search', { sessionId: s.sessionId, offset: 10000 });
    assert.equal(r.returned, 0);
    assert.equal(r.total, s.count);
    assert.equal(r.truncated, false);
  });
});

// -- where reaches the tool ------------------------------------------------

test('where filters are wired through log_search', async () => {
  await withClient({}, async (c) => {
    const s = await c.call('log_open', { path: ERR_LOG });
    const r = await c.call('log_search', {
      sessionId: s.sessionId, where: { has_error: true }, fields: ['method'],
    });
    assert.deepEqual(r.rows.map((x) => x.method).sort(), ['inner', 'outer']);
    assert.equal(r.total, 2);
  });
});

test('where filters are wired through log_aggregate', async () => {
  await withClient({}, async (c) => {
    const s = await c.call('log_open', { path: LOG });
    const all = await c.call('log_aggregate', {
      sessionId: s.sessionId, groupBy: ['method'], metric: { op: 'count' },
    });
    const entersOnly = await c.call('log_aggregate', {
      sessionId: s.sessionId, groupBy: ['method'], metric: { op: 'count' },
      where: { event: 'enter' },
    });
    const total = (rs) => rs.reduce((n, r) => n + r.value, 0);
    assert.equal(total(all), s.count);
    assert.equal(total(entersOnly), s.count / 2, 'enter and exit events are paired');
  });
});

// -- runner --
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
