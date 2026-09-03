/**
 * The wire half of the emitter: what happens to a batch once flush() runs.
 * The queue was tested; the transport — fetch, sendBeacon, the failure path,
 * the unload listeners — was not, which is how a silent drop shipped.
 *
 * Runs with: node --test test/test-emitter-transport.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configure, emit, flush, resetEmitter, droppedCount, installUnloadFlush,
} from '../src/emitter.js';
import { initFlowtrace, _resetInitForTests } from '../src/api.js';
import { resetContext } from '../src/context.js';

const savedFetch = globalThis.fetch;
// `navigator` is a getter-only global on modern Node, so it is swapped via
// defineProperty rather than assignment.
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const savedConsoleWarn = console.warn;
let warnings;

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function event(i) {
  return { event: 'enter', span_id: `s${i}` };
}

beforeEach(() => {
  resetEmitter();
  resetContext();
  _resetInitForTests();
  warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
  else delete globalThis.navigator;
  console.warn = savedConsoleWarn;
  delete globalThis.document;
  delete globalThis.addEventListener;
  delete globalThis.location;
});

test('a batch is POSTed as JSON to the configured endpoint', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  configure({ endpoint: 'http://collector.test/api/trace', flushIntervalMs: 0 });
  emit(event(1));
  emit(event(2));
  assert.equal(await flush(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://collector.test/api/trace');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(calls[0].init.body), [event(1), event(2)]);
  assert.equal(droppedCount(), 0);
  assert.deepEqual(warnings, []);
});

test('an unreachable collector drops the batch, counts it, and warns once', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  configure({ flushIntervalMs: 0 });
  emit(event(1)); emit(event(2)); emit(event(3));
  await flush();
  emit(event(4));
  await flush();
  assert.equal(droppedCount(), 4, 'every event of every failed batch is counted');
  assert.equal(warnings.length, 1, 'one warning, not one per batch');
  assert.match(warnings[0], /unreachable/);
});

test('a non-2xx answer from the collector is a loss too', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 413 });
  configure({ flushIntervalMs: 0 });
  emit(event(1));
  await flush();
  assert.equal(droppedCount(), 1);
  assert.match(warnings[0], /413/);
});

test('beacon: true prefers sendBeacon with text/plain and falls back to fetch when refused', async () => {
  const beacons = [];
  let fetched = 0;
  setNavigator({ sendBeacon(url, blob) { beacons.push({ url, type: blob.type }); return beacons.length === 1; } });
  globalThis.fetch = async () => { fetched++; return { ok: true, status: 200 }; };
  configure({ flushIntervalMs: 0 });

  emit(event(1));
  await flush({ beacon: true });
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].type, 'text/plain', 'text/plain keeps the beacon a simple request');
  assert.equal(fetched, 0);

  emit(event(2));
  await flush({ beacon: true }); // second beacon returns false -> fetch fallback
  assert.equal(fetched, 1);
});

test('an https page with a plaintext endpoint is warned about at configure time', () => {
  globalThis.location = { protocol: 'https:', href: 'https://app.test/' };
  configure({});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /mixed content/);
  configure({});
  assert.equal(warnings.length, 1, 'still once');
  configure({ endpoint: 'https://collector.test/api/trace' });
  assert.equal(warnings.length, 1, 'an https endpoint is fine');
});

test('installUnloadFlush and initFlowtrace register listeners once', () => {
  const listeners = [];
  globalThis.document = { addEventListener: (n) => listeners.push(`document:${n}`), visibilityState: 'visible' };
  globalThis.addEventListener = (n) => listeners.push(`window:${n}`);

  assert.equal(installUnloadFlush(), true);
  assert.equal(installUnloadFlush(), true);
  assert.deepEqual(listeners, ['document:visibilitychange', 'window:pagehide']);

  listeners.length = 0;
  initFlowtrace({ flushIntervalMs: 0 });
  initFlowtrace({ flushIntervalMs: 0 });
  assert.deepEqual(listeners, ['window:error', 'window:unhandledrejection'],
    'a second init (hydration, HMR) does not double the error listeners');
});
