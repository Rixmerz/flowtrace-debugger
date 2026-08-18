/**
 * The browser events must satisfy schema v2 exactly like every other capture
 * layer's do. Validating against the real schema here is the whole point: the
 * mapping of browser concepts onto module/class/method is only sound if what
 * comes out is indistinguishable, structurally, from a server span.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

import { startSpan, resetContext } from '../src/context.js';
import {
  httpEnter, httpExit, routeEnter, routeExit, errorPair, toErrorObj, scrubUrl,
} from '../src/events.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const schema = JSON.parse(readFileSync(join(REPO, 'schema', 'flowtrace-v2.json'), 'utf8'));
const validate = new Ajv({ strict: false }).compile(schema);

function assertValid(ev, label) {
  const ok = validate(ev);
  assert.ok(ok, `${label} failed schema: ${JSON.stringify(validate.errors)}`);
}

test('http enter and exit events validate against schema v2', () => {
  resetContext();
  const ctx = startSpan();
  assertValid(httpEnter(ctx, { method: 'get', url: 'http://api.test/orders/7' }), 'httpEnter');
  assertValid(httpExit(ctx, {
    method: 'get', url: 'http://api.test/orders/7', status: 200, durationNs: 12345,
  }), 'httpExit');
});

test('a failed http exit carries error and still carries result', () => {
  resetContext();
  const ctx = startSpan();
  const ev = httpExit(ctx, {
    method: 'POST', url: 'http://api.test/orders', status: 500, durationNs: 5,
    error: new Error('boom'),
  });
  assertValid(ev, 'failed httpExit');
  // The rule the other three layers each broke once.
  assert.deepEqual(ev.result, {});
  assert.equal(ev.error.type, 'Error');
  assert.equal(ev.error.msg, 'boom');
});

test('route events validate and record both endpoints', () => {
  resetContext();
  const ctx = startSpan();
  assertValid(routeEnter(ctx, { from: '/a', to: '/b' }), 'routeEnter');
  const exit = routeExit(ctx, { from: '/a', to: '/b', durationNs: 100 });
  assertValid(exit, 'routeExit');
  assert.match(exit.args.to, /\/b$/);
});

test('an error is emitted as a valid enter/exit pair', () => {
  resetContext();
  const ctx = startSpan();
  const [enter, exit] = errorPair(ctx, new TypeError('nope'), 'window.onerror');
  assertValid(enter, 'error enter');
  assertValid(exit, 'error exit');
  assert.equal(enter.span_id, exit.span_id, 'one span, two events');
  assert.equal(exit.error.type, 'TypeError');
  assert.equal(exit.duration_ns, 0);
});

test('a thrown non-Error still produces a schema-valid error object', () => {
  const e = toErrorObj('just a string');
  assert.equal(e.type, 'unknown');
  assert.equal(e.msg, 'just a string');
  assert.deepEqual(e.stack, []);
});

test('duration is never negative even if the clock goes backwards', () => {
  resetContext();
  const ctx = startSpan();
  const ev = httpExit(ctx, { method: 'GET', url: '/x', status: 200, durationNs: -50 });
  assert.equal(ev.duration_ns, 0);
  assertValid(ev, 'clamped duration');
});

// -- url scrubbing ---------------------------------------------------------

test('query strings are dropped from recorded urls', () => {
  // Traces get shared. Query strings routinely carry tokens and personal data,
  // so they must never reach the file.
  const url = 'https://api.test/search?token=SECRET&q=hello';
  assert.equal(scrubUrl(url), 'https://api.test/search');
  resetContext();
  const ctx = startSpan();
  const ev = httpEnter(ctx, { method: 'GET', url });
  assert.equal(JSON.stringify(ev).includes('SECRET'), false, 'no secret anywhere in the event');
});

test('fragments are dropped too', () => {
  assert.equal(scrubUrl('https://api.test/page#section'), 'https://api.test/page');
});

test('a relative url is resolved rather than dropped', () => {
  assert.match(scrubUrl('/api/orders?x=1'), /\/api\/orders$/);
});

test('a junk url never throws and still loses its query string', () => {
  // Given a base, URL resolves almost any string rather than throwing, so the
  // contract worth asserting is not "it falls back" but "it never throws and
  // the query never survives" — the two properties callers depend on.
  for (const junk of ['::::not a url::::?a=SECRET', '', '   ', 'http://', '//x?b=SECRET']) {
    const out = scrubUrl(junk);
    assert.equal(typeof out, 'string');
    assert.equal(out.includes('SECRET'), false, `query leaked from ${JSON.stringify(junk)}`);
  }
});

test('a non-string url is coerced rather than throwing', () => {
  for (const bad of [null, undefined, 42, {}]) {
    assert.equal(typeof scrubUrl(bad), 'string');
  }
});
