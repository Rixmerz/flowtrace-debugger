import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:http';
import { runInSpan, getCurrent, runWithRemoteContext } from '../src/runtime/context.js';
import { installOutgoingPropagation } from '../src/runtime/propagate.js';

const TP_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

installOutgoingPropagation();

/** Starts a server that echoes back the headers it received. */
function echoServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.headers));
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

/** Issues a request with node:http and resolves the echoed headers. */
function httpGet(args) {
  return new Promise((resolve, reject) => {
    const req = http.request(...args, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.end();
  });
}

test('fetch carries traceparent when a span is active', async () => {
  const { server, port } = await echoServer();
  try {
    await runInSpan(async () => {
      const ctx = getCurrent();
      const headers = await (await fetch(`http://127.0.0.1:${port}/`)).json();
      assert.match(headers.traceparent, TP_RE);
      assert.ok(headers.traceparent.includes(ctx.trace_id), 'carries the active trace');
      assert.ok(headers.traceparent.includes(ctx.span_id), 'parent is the active span');
    });
  } finally { server.close(); }
});

test('fetch sends no traceparent outside any span', async () => {
  // A request made by untraced code must go out exactly as it would have.
  const { server, port } = await echoServer();
  try {
    const headers = await (await fetch(`http://127.0.0.1:${port}/`)).json();
    assert.equal(headers.traceparent, undefined);
  } finally { server.close(); }
});

test('fetch does not overwrite a traceparent the caller set', async () => {
  const { server, port } = await echoServer();
  const mine = `00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`;
  try {
    await runInSpan(async () => {
      const headers = await (await fetch(`http://127.0.0.1:${port}/`, {
        headers: { traceparent: mine },
      })).json();
      assert.equal(headers.traceparent, mine, 'an app doing its own propagation wins');
    });
  } finally { server.close(); }
});

test('fetch preserves the caller other headers', async () => {
  const { server, port } = await echoServer();
  try {
    await runInSpan(async () => {
      const headers = await (await fetch(`http://127.0.0.1:${port}/`, {
        headers: { 'x-custom': 'kept', accept: 'application/json' },
      })).json();
      assert.equal(headers['x-custom'], 'kept');
      assert.equal(headers.accept, 'application/json');
      assert.match(headers.traceparent, TP_RE);
    });
  } finally { server.close(); }
});

test('fetch propagates an adopted remote trace onward', async () => {
  const { server, port } = await echoServer();
  const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
  try {
    await runWithRemoteContext(`00-${TRACE}-00f067aa0ba902b7-01`, async () => {
      await runInSpan(async () => {
        const headers = await (await fetch(`http://127.0.0.1:${port}/`)).json();
        assert.ok(headers.traceparent.includes(TRACE), 'the trace survives a second hop');
      });
    });
  } finally { server.close(); }
});

test('http.request carries traceparent with an options object', async () => {
  const { server, port } = await echoServer();
  try {
    await runInSpan(async () => {
      const headers = await httpGet([{ host: '127.0.0.1', port, path: '/' }]);
      assert.match(headers.traceparent, TP_RE);
    });
  } finally { server.close(); }
});

test('http.request carries traceparent when given only a URL', async () => {
  // The overload with no options object at all — the wrapper has to insert one.
  const { server, port } = await echoServer();
  try {
    await runInSpan(async () => {
      const headers = await httpGet([`http://127.0.0.1:${port}/`]);
      assert.match(headers.traceparent, TP_RE);
    });
  } finally { server.close(); }
});

test('http.request keeps the caller options and headers intact', async () => {
  const { server, port } = await echoServer();
  try {
    await runInSpan(async () => {
      const headers = await httpGet([{
        host: '127.0.0.1', port, path: '/', headers: { 'x-custom': 'kept' },
      }]);
      assert.equal(headers['x-custom'], 'kept');
      assert.match(headers.traceparent, TP_RE);
    });
  } finally { server.close(); }
});

test('http.request does not mutate the caller options object', async () => {
  // The caller may reuse this object for a later request; a traceparent left
  // behind on it would attach a stale span to a future call.
  const { server, port } = await echoServer();
  const opts = { host: '127.0.0.1', port, path: '/', headers: { a: '1' } };
  try {
    await runInSpan(async () => { await httpGet([opts]); });
    assert.deepEqual(opts.headers, { a: '1' }, 'caller object untouched');
  } finally { server.close(); }
});

test('http.request does not overwrite a caller traceparent', async () => {
  const { server, port } = await echoServer();
  const mine = `00-${'e'.repeat(32)}-${'f'.repeat(16)}-01`;
  try {
    await runInSpan(async () => {
      const headers = await httpGet([{
        host: '127.0.0.1', port, path: '/', headers: { TraceParent: mine },
      }]);
      // Header name casing must not defeat the check.
      assert.equal(headers.traceparent, mine);
    });
  } finally { server.close(); }
});

test('installing twice does not stack wrappers', async () => {
  const { server, port } = await echoServer();
  installOutgoingPropagation();
  installOutgoingPropagation();
  try {
    await runInSpan(async () => {
      const headers = await (await fetch(`http://127.0.0.1:${port}/`)).json();
      // A stacked wrapper would still yield one header, but the count check
      // below is the real assertion: node lowercases and would join duplicates
      // with a comma.
      assert.match(headers.traceparent, TP_RE);
      assert.equal(headers.traceparent.includes(','), false, 'exactly one value');
    });
  } finally { server.close(); }
});

test('a request survives when there is no active span and no context at all', async () => {
  // Regression guard for the "never throw" rule: propagation failing must
  // never turn into an application error.
  const { server, port } = await echoServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
  } finally { server.close(); }
});

test('FLOWTRACE_PROPAGATE=0 disables installation', () => {
  const prev = process.env.FLOWTRACE_PROPAGATE;
  process.env.FLOWTRACE_PROPAGATE = '0';
  try {
    assert.equal(installOutgoingPropagation(), false);
  } finally {
    if (prev === undefined) delete process.env.FLOWTRACE_PROPAGATE;
    else process.env.FLOWTRACE_PROPAGATE = prev;
  }
});
