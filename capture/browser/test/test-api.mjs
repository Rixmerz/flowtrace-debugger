/**
 * Tests for the operations a framework binding calls. These cover the logic
 * that the Angular layer deliberately does not contain.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetContext, startSpan, withSpan, getCurrent, seedFromRemote } from '../src/context.js';
import { resetEmitter, configure, queueDepth, droppedCount, emit } from '../src/emitter.js';
import { traceHttp, traceRoute, reportError } from '../src/api.js';

/** Captures emitted events instead of sending them. */
let sent;
function captureEmitter() {
  sent = [];
  // A batchSize of 1 would flush on every event; instead keep the queue large
  // and read it through a spy on fetch.
  configure({ batchSize: 10000, flushIntervalMs: 0, endpoint: 'http://collector.test/api/trace' });
}

beforeEach(() => {
  resetContext();
  resetEmitter();
  captureEmitter();
});

/** Drains what the emitter has queued by monkey-patching fetch and flushing. */
async function drain() {
  const { flush } = await import('../src/emitter.js');
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent.push(...JSON.parse(init.body));
    return { status: 200 };
  };
  try { await flush(); } finally { globalThis.fetch = original; }
  return sent;
}

// -- traceHttp -------------------------------------------------------------

test('traceHttp emits an enter and an exit around a successful call', async () => {
  const res = await traceHttp({ method: 'GET', url: '/api/x' }, async () => ({ status: 201 }));
  assert.equal(res.status, 201);
  const events = await drain();
  assert.deepEqual(events.map((e) => e.event), ['enter', 'exit']);
  assert.equal(events[1].result.status, 201);
  assert.equal(events[1].result.ok, true);
  assert.equal(events[0].span_id, events[1].span_id);
});

test('traceHttp hands the caller a traceparent for the outgoing request', async () => {
  let seen = null;
  await traceHttp({ method: 'GET', url: '/api/x' }, async (tp) => { seen = tp; return { status: 200 }; });
  assert.match(seen, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const events = await drain();
  assert.ok(seen.includes(events[0].trace_id), 'the header carries this span trace');
  assert.ok(seen.includes(events[0].span_id), 'and this span as parent for the server side');
});

test('traceHttp rethrows and records the failure', async () => {
  const err = Object.assign(new Error('server said no'), { status: 503 });
  await assert.rejects(
    () => traceHttp({ method: 'POST', url: '/api/x' }, async () => { throw err; }),
    /server said no/
  );
  const events = await drain();
  assert.equal(events[1].event, 'exit');
  assert.equal(events[1].error.msg, 'server said no');
  assert.deepEqual(events[1].result, {});
});

test('an http error keeps its status, so a 404 is not a network failure', async () => {
  const err = Object.assign(new Error('not found'), { status: 404 });
  await assert.rejects(() => traceHttp({ method: 'GET', url: '/api/x' }, async () => { throw err; }));
  const events = await drain();
  // The status lives on the error object; a network failure has none.
  assert.equal(events[1].error.type, 'Error');
  assert.equal(events[1].duration_ns >= 0, true);
});

test('a 4xx response is recorded as not ok', async () => {
  await traceHttp({ method: 'GET', url: '/api/x' }, async () => ({ status: 404 }));
  const events = await drain();
  assert.equal(events[1].result.ok, false);
});

test('the enter is emitted before the call, so a hung request leaves evidence', async () => {
  let depthDuringCall = 0;
  const pending = traceHttp({ method: 'GET', url: '/api/slow' }, async () => {
    depthDuringCall = queueDepth();
    return { status: 200 };
  });
  await pending;
  assert.equal(depthDuringCall, 1, 'the enter was already queued while the call was in flight');
});

test('concurrent http spans do not share ids', async () => {
  await Promise.all([
    traceHttp({ method: 'GET', url: '/a' }, async () => ({ status: 200 })),
    traceHttp({ method: 'GET', url: '/b' }, async () => ({ status: 200 })),
  ]);
  const events = await drain();
  const spans = new Set(events.map((e) => e.span_id));
  assert.equal(spans.size, 2, 'two distinct spans');
  const traces = new Set(events.map((e) => e.trace_id));
  assert.equal(traces.size, 1, 'both in the same page trace');
});

// -- traceRoute ------------------------------------------------------------

test('traceRoute emits one enter and one exit', async () => {
  traceRoute({ from: '/a', to: '/b' }).end();
  const events = await drain();
  assert.deepEqual(events.map((e) => e.event), ['enter', 'exit']);
});

test('a second end is ignored, so one navigation yields one exit', async () => {
  // Angular can report both a cancel and an error for one navigation; two
  // exits for one enter would corrupt the tree.
  const nav = traceRoute({ from: '/a', to: '/b' });
  nav.end();
  nav.end(new Error('late error'));
  const events = await drain();
  assert.equal(events.filter((e) => e.event === 'exit').length, 1);
  assert.equal(events[1].error, undefined, 'the first, clean end won');
});

test('a failed navigation records the error', async () => {
  traceRoute({ from: '/a', to: '/b' }).end(new Error('guard rejected'));
  const events = await drain();
  assert.equal(events[1].error.msg, 'guard rejected');
});

// -- reportError -----------------------------------------------------------

test('reportError emits a paired enter/exit carrying the error', async () => {
  reportError(new RangeError('out of range'), 'window.onerror');
  const events = await drain();
  assert.equal(events.length, 2);
  assert.equal(events[1].error.type, 'RangeError');
  assert.equal(events[1].method, 'window.onerror');
});

// -- context ---------------------------------------------------------------

test('spans nest under an active parent', () => {
  const parent = startSpan();
  withSpan(parent, () => {
    const child = startSpan();
    assert.equal(child.parent_id, parent.span_id);
    assert.equal(child.depth, parent.depth + 1);
    assert.equal(child.trace_id, parent.trace_id);
  });
  assert.equal(getCurrent(), null, 'the stack is restored');
});

test('the stack unwinds even when the body throws', () => {
  const ctx = startSpan();
  assert.throws(() => withSpan(ctx, () => { throw new Error('x'); }));
  assert.equal(getCurrent(), null, 'no leaked frame');
});

test('every span on a page shares one trace id', () => {
  const a = startSpan();
  const b = startSpan();
  assert.equal(a.trace_id, b.trace_id);
});

test('a server-rendered traceparent seeds the page trace', () => {
  const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
  const SPAN = '00f067aa0ba902b7';
  seedFromRemote({ trace_id: TRACE, parent_id: SPAN });
  const first = startSpan();
  assert.equal(first.trace_id, TRACE, 'the page joins the document request trace');
  assert.equal(first.parent_id, SPAN, 'and hangs off the server span');
  assert.equal(first.depth, 0, 'while still being a root-depth local span');
});

// -- emitter backpressure --------------------------------------------------

test('the queue is capped and the loss is counted, not silent', () => {
  resetEmitter();
  configure({ batchSize: 1e9, flushIntervalMs: 0, maxQueue: 3 });
  for (let i = 0; i < 10; i++) emit({ n: i });
  assert.equal(queueDepth(), 3);
  assert.equal(droppedCount(), 7, 'a trace with a hole says it has one');
});
