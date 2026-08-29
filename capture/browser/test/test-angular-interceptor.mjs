/**
 * The Angular binding is otherwise untested by design — everything it decides
 * lives in api.js, and testing the wiring means standing up TestBed. But the
 * interceptor has one obligation that cannot be checked in api.js and that has
 * already been broken once in a way nothing observable caught: it must return
 * the Observable of HttpEvents, unaltered.
 *
 * A version that returned a Promise still sent the request, still got a 200
 * and still recorded a correct span, while every caller's subscribe() landed
 * on its error branch. So these tests assert on what the *caller* receives,
 * not on what gets emitted. rxjs is the real one — a stub Observable would
 * pass against the very Promise that shipped the bug.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, of, throwError } from 'rxjs';

import { resetContext } from '../src/context.js';
import { resetEmitter, configure, flush } from '../src/emitter.js';
import { flowtraceInterceptor } from '../src/angular.js';

let sent;
beforeEach(() => {
  resetContext();
  resetEmitter();
  sent = [];
  configure({ batchSize: 10000, flushIntervalMs: 0, endpoint: 'http://collector.test/api/trace' });
});

async function drain() {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { sent.push(...JSON.parse(init.body)); return { status: 200 }; };
  try { await flush(); } finally { globalThis.fetch = original; }
  return sent;
}

/** The shape of Angular's HttpRequest that this interceptor actually touches. */
function fakeRequest(method, url, headers = {}) {
  return {
    method,
    url,
    headers: { has: (name) => name in headers, all: headers },
    clone({ setHeaders }) { return fakeRequest(method, url, { ...headers, ...setHeaders }); },
  };
}

test('the caller gets the response on next, not on error', async () => {
  const response = { status: 200, body: 'ok' };
  const result = flowtraceInterceptor(fakeRequest('GET', '/api/x'), () => of(response));

  assert.ok(result instanceof Observable, 'an HttpInterceptorFn must return an Observable');

  const seen = { next: [], error: null, complete: false };
  await new Promise((done) => {
    result.subscribe({
      next: (e) => seen.next.push(e),
      error: (e) => { seen.error = e; done(); },
      complete: () => { seen.complete = true; done(); },
    });
  });

  assert.equal(seen.error, null, 'the success path must never reach the error branch');
  assert.deepEqual(seen.next, [response]);
  assert.ok(seen.complete);

  const events = await drain();
  assert.deepEqual(events.map((e) => e.event), ['enter', 'exit']);
  assert.equal(events[1].result.status, 200);
});

test('every HttpEvent passes through, not just the last', async () => {
  const events = [{ type: 1, loaded: 10 }, { type: 1, loaded: 20 }, { status: 200 }];
  const result = flowtraceInterceptor(fakeRequest('POST', '/api/upload'), () => of(...events));

  const seen = [];
  await new Promise((done) => result.subscribe({ next: (e) => seen.push(e), complete: done }));
  assert.deepEqual(seen, events, 'progress events must not be swallowed');
});

test('the outgoing request carries a traceparent matching the span', async () => {
  let outbound = null;
  const result = flowtraceInterceptor(fakeRequest('GET', '/api/x'), (req) => {
    outbound = req;
    return of({ status: 200 });
  });
  await new Promise((done) => result.subscribe({ complete: done }));

  const tp = outbound.headers.all.traceparent;
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const events = await drain();
  assert.ok(tp.includes(events[0].trace_id));
  assert.ok(tp.includes(events[0].span_id));
});

test('an app doing its own propagation keeps its header', async () => {
  const mine = '00-11111111111111111111111111111111-2222222222222222-01';
  let outbound = null;
  const result = flowtraceInterceptor(
    fakeRequest('GET', '/api/x', { traceparent: mine }),
    (req) => { outbound = req; return of({ status: 200 }); },
  );
  await new Promise((done) => result.subscribe({ complete: done }));
  assert.equal(outbound.headers.all.traceparent, mine);
});

test('a failure reaches the caller error branch and is recorded', async () => {
  const failure = { status: 404, message: 'nope' };
  const result = flowtraceInterceptor(fakeRequest('GET', '/api/missing'), () => throwError(() => failure));

  let caught = null;
  await new Promise((done) => result.subscribe({ error: (e) => { caught = e; done(); }, complete: done }));
  assert.equal(caught, failure, 'the error must propagate unchanged');

  const events = await drain();
  assert.equal(events[1].event, 'exit');
  assert.ok(events[1].error, 'the failure is recorded on the exit');
});

test('unsubscribing tears down the underlying request', async () => {
  let torndown = false;
  const result = flowtraceInterceptor(fakeRequest('GET', '/api/slow'), () => new Observable(() => {
    return () => { torndown = true; };
  }));

  const sub = result.subscribe({ next: () => {}, error: () => {} });
  sub.unsubscribe();
  assert.ok(torndown, 'a cancelled request must not keep flying');

  // Cancelled: an enter with no exit, which is this schema's "started, never
  // finished". Emitting an exit would claim a completion that never happened.
  const events = await drain();
  assert.deepEqual(events.map((e) => e.event), ['enter']);
});
