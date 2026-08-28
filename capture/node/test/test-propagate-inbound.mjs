/**
 * Inbound propagation: a server adopts the caller's traceparent instead of
 * minting a fresh trace per request.
 *
 * This is asserted here rather than in a golden fixture for the same reason
 * as test-cross-process.mjs: the golden normalizer rewrites every trace_id to
 * one constant, so a fixture looks identical whether or not correlation
 * actually happened. The property only exists in the raw ids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { installOutgoingPropagation } from '../src/runtime/propagate.js';
import { runInSpan, getCurrent } from '../src/runtime/context.js';

installOutgoingPropagation();

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

/** Starts a server whose handler reports the span context it observed. */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a request carrying traceparent runs inside the caller context', async () => {
  const { server, port } = await serve((req, res) => {
    // Two observations: the ambient context the patch installed (the synthetic
    // remote parent), and the context an instrumented function would get.
    // A span records its parent as the span_id of the enclosing context, so
    // asserting the seed IS asserting what parent_id the first span will carry.
    res.end(JSON.stringify({ seed: getCurrent(), span: runInSpan(() => getCurrent()) }));
  });
  try {
    const { seed, span } = JSON.parse(await get(port, { traceparent: `00-${TRACE}-${SPAN}-01` }));

    assert.ok(seed, 'no context was installed — the request was not seeded at all');
    assert.equal(seed.trace_id, TRACE, 'seeded a different trace than the caller sent');
    assert.equal(seed.span_id, SPAN, 'the first local span would parent onto the wrong span');
    assert.equal(seed.depth, -1, 'the synthetic parent must sit at -1 so the first local span is 0');
    assert.equal(seed.remote, true);

    assert.equal(span.trace_id, TRACE, 'server minted its own trace instead of adopting the caller\'s');
    assert.equal(span.depth, 0, 'the remote parent must not count as a local frame');
  } finally {
    server.close();
  }
});

test('a request with no traceparent still gets a normal root span', async () => {
  const { server, port } = await serve((req, res) => {
    res.end(JSON.stringify(runInSpan(() => getCurrent())));
  });
  try {
    const ctx = JSON.parse(await get(port, {}));
    assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
    assert.notEqual(ctx.trace_id, TRACE);
    assert.equal(ctx.depth, 0, 'an unseeded request must start a real root at depth 0');
  } finally {
    server.close();
  }
});

test('a malformed traceparent is ignored, not propagated', async () => {
  const { server, port } = await serve((req, res) => {
    res.end(JSON.stringify(runInSpan(() => getCurrent())));
  });
  try {
    const ctx = JSON.parse(await get(port, { traceparent: 'not-a-traceparent' }));
    assert.notEqual(ctx.trace_id, TRACE, 'a garbage header must degrade to a fresh root');
    assert.equal(ctx.depth, 0);
  } finally {
    server.close();
  }
});

test('installing twice does not stack wrappers', async () => {
  installOutgoingPropagation();
  installOutgoingPropagation();
  const { server, port } = await serve((req, res) => {
    res.end(JSON.stringify(runInSpan(() => getCurrent())));
  });
  try {
    const ctx = JSON.parse(await get(port, { traceparent: `00-${TRACE}-${SPAN}-01` }));
    assert.equal(ctx.trace_id, TRACE);
    assert.equal(ctx.depth, 0, 'a stacked wrapper would seed twice and shift depth');
  } finally {
    server.close();
  }
});

test('non-request events are untouched', async () => {
  const { server, port } = await serve((req, res) => res.end('ok'));
  try {
    const sawListening = await new Promise((resolve) => {
      const s = http.createServer(() => {});
      s.on('listening', () => { s.close(); resolve(true); });
      s.listen(0, '127.0.0.1');
    });
    assert.equal(sawListening, true, 'patching emit must not swallow other events');
    assert.equal(await get(port, {}), 'ok');
  } finally {
    server.close();
  }
});
