/**
 * Unit tests for the runtime helpers the transform injects (instrument.js):
 * what ends up in args / result and under which rules.
 *
 * Runs with: node --test test/test-instrument.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from 'node:http';

import { init } from '../src/runtime/emitter.js';

let counter = 0;

/**
 * A fresh instrument module (its config is cached per module instance) writing
 * to a fresh file. `env` is applied before the module reads it.
 */
async function harness(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-instr-'));
  const out = join(dir, 'trace.jsonl');
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const mod = await import(`../src/runtime/instrument.js?n=${++counter}`);
  mod._resetConfigForTests();
  init(out);
  return {
    mod,
    events() {
      return readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    done() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function call(mod, params, args, result, lang) {
  const ctx = mod.__ft_enter('m', null, 'f', 'public', params, args, lang);
  mod.__ft_exit(ctx, 'm', null, 'f', 'public', params, args, result, lang);
  return ctx;
}

test('result is wrapped in {value} and {} for undefined/null', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    call(h.mod, ['a'], [1], 42);
    call(h.mod, [], [], undefined);
    call(h.mod, [], [], null);
    const exits = h.events().filter((e) => e.event === 'exit');
    assert.deepEqual(exits.map((e) => e.result), [{ value: 42 }, {}, {}]);
  } finally { h.done(); }
});

test('args and result are truncated independently at FLOWTRACE_MAX_ARG_LENGTH', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: '32', FLOWTRACE_REDACT_KEYS: undefined });
  try {
    const long = 'x'.repeat(500);
    call(h.mod, ['data'], [long], long);
    const [enter, exit] = h.events();
    assert.match(enter.args.data, /^<truncated:"x{31}\.\.\.>$/);
    assert.match(exit.result.value, /^<truncated:"x{31}\.\.\.>$/, 'result obeys the same limit as args');
    assert.ok(JSON.stringify(exit.result.value).length < 100);
  } finally { h.done(); }
});

test('FLOWTRACE_MAX_ARG_LENGTH=0 disables truncation', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: '0', FLOWTRACE_REDACT_KEYS: undefined });
  try {
    const long = 'y'.repeat(2000);
    call(h.mod, ['data'], [long], long);
    const [enter, exit] = h.events();
    assert.equal(enter.args.data, long);
    assert.equal(exit.result.value, long);
  } finally { h.done(); }
});

test('redaction: default keys, nested keys, result, and FLOWTRACE_REDACT_KEYS is additive', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: 'ssn' });
  try {
    call(
      h.mod,
      ['password', 'user', 'opts'],
      ['hunter2', 'jane', { apiKey: 'k', Authorization: 'Bearer x', nested: { db_url: 'pg://', ok: 1 }, ssn: '1' }],
      { token: 't', fine: true }
    );
    const [enter, exit] = h.events();
    assert.equal(enter.args.password, '<redacted>');
    assert.equal(enter.args.user, 'jane');
    assert.deepEqual(enter.args.opts, {
      apiKey: 'k', // "apiKey" does not contain "api_key" — substring match is literal, as in Python/Go
      Authorization: '<redacted>',
      nested: { db_url: '<redacted>', ok: 1 },
      ssn: '<redacted>',
    });
    assert.deepEqual(exit.result, { value: { token: '<redacted>', fine: true } });
  } finally { h.done(); }
});

test('values JSON cannot carry do not lose the whole argument', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    const cyc = { name: 'c' };
    cyc.self = cyc;
    call(h.mod, ['big', 'cyc', 'fn', 'sym'], [123n, cyc, () => 1, Symbol('s')], { n: 5n });
    const [enter, exit] = h.events();
    assert.equal(enter.args.big, '123');
    assert.deepEqual(enter.args.cyc, { name: 'c', self: '[Circular]' });
    assert.equal('fn' in enter.args, false, 'functions vanish like they do in JSON');
    assert.equal('sym' in enter.args, false);
    assert.deepEqual(exit.result, { value: { n: '5' } });
  } finally { h.done(); }
});

test('an EventEmitter is tagged by class, not walked into Node internals', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    const { EventEmitter } = await import('node:events');
    class Bus extends EventEmitter {}
    const server = createServer(() => {});
    call(h.mod, ['bus', 'srv', 'anon'], [new Bus(), server, new EventEmitter()], undefined);
    server.close();
    const [enter] = h.events();
    assert.equal(enter.args.bus, '<Bus>');
    assert.equal(enter.args.srv, '<Server>');
    assert.equal(enter.args.anon, '<EventEmitter>');
  } finally { h.done(); }
});

test('an http request and response are tagged, so args do not pin the Node version', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  const server = createServer((req, res) => {
    call(h.mod, ['req', 'res'], [req, res], undefined);
    res.end('ok');
  });
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await fetch(`http://127.0.0.1:${server.address().port}/orders/7`);
    const [enter] = h.events();
    // Not `<truncated:{"_events":{},"_readableState":{"highWaterMark":16384...`,
    // which differs between Node majors and says nothing about the handler.
    assert.equal(enter.args.req, '<IncomingMessage>');
    assert.equal(enter.args.res, '<ServerResponse>');
  } finally {
    await new Promise((r) => server.close(r));
    h.done();
  }
});

test('an ordinary object with an "on" property is still serialized in full', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    // The duck-type needs all three EventEmitter methods; a domain object that
    // happens to carry one must not disappear behind a tag.
    call(h.mod, ['cfg'], [{ on: () => {}, retries: 3 }], undefined);
    assert.deepEqual(h.events()[0].args.cfg, { retries: 3 });
  } finally { h.done(); }
});

test('a thrown error produces an exit with result {} and an error object', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    const ctx = h.mod.__ft_enter('m', 'C', 'boom', 'private', ['x'], [1]);
    h.mod.__ft_exit_error(ctx, 'm', 'C', 'boom', 'private', ['x'], [1], new TypeError('nope'));
    const [, exit] = h.events();
    assert.deepEqual(exit.result, {});
    assert.equal(exit.error.type, 'TypeError');
    assert.equal(exit.error.msg, 'nope');
    assert.ok(Array.isArray(exit.error.stack) && exit.error.stack.length > 0);
    assert.equal(exit.class, 'C');
    assert.equal(exit.visibility, 'private');
  } finally { h.done(); }
});

test('thread is "main" here, lang defaults to "node" and honours "ts"', async () => {
  const h = await harness({ FLOWTRACE_MAX_ARG_LENGTH: undefined, FLOWTRACE_REDACT_KEYS: undefined });
  try {
    call(h.mod, [], [], 1);
    call(h.mod, [], [], 1, 'ts');
    const events = h.events();
    assert.ok(events.every((e) => e.thread === 'main'));
    assert.deepEqual(events.map((e) => e.lang), ['node', 'node', 'ts', 'ts']);
    assert.ok(events.every((e) => e.class === ''), 'null class is emitted as ""');
  } finally { h.done(); }
});
