/**
 * Tests for src/transform/swc.js
 * Runs with: node --test test/test-transform.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from '../src/transform/swc.js';

// ── helpers ──────────────────────────────────────────────────

const emittedEvents = [];
let mockInstrumentInstalled = false;

/**
 * Evaluate transformed CJS code in a controlled sandbox.
 * We provide stub runtime helpers so no real file I/O happens.
 *
 * @param {string} code - Transformed source (CJS).
 * @param {string} runtimePath - The require() path the transform injected.
 * @returns {{ Module, events: Array }}
 */
function evalCjs(code, runtimePath = '__ft_runtime__') {
  const events = [];

  // Build a minimal require() that hands back our stubs for the runtime.
  const stubs = {
    [runtimePath]: makeStubs(events),
  };

  const _require = (id) => {
    if (stubs[id]) return stubs[id];
    // Pass through Node built-ins.
    if (id.startsWith('node:') || !id.startsWith('.')) {
      return require(id); // eslint-disable-line no-undef
    }
    throw new Error(`require('${id}') not stubbed in test`);
  };

  // Wrap in a function to simulate CommonJS module wrapper.
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', code); // eslint-disable-line no-new-func
  const mod = { exports: {} };
  fn(_require, mod, mod.exports, '/test', '/test/fixture.js');
  return { exports: mod.exports, events };
}

function makeStubs(events) {
  const ctxMap = new Map();
  let ctxCounter = 0;

  return {
    __ft_enter(module_, cls, method, visibility, paramNames, args) {
      const id = ++ctxCounter;
      const ctx = { id, module_, cls, method, visibility, paramNames, args, start: process.hrtime.bigint() };
      events.push({ type: 'enter', module: module_, cls, method, visibility, args });
      return ctx;
    },
    __ft_exit(ctx, module_, cls, method, visibility, paramNames, args, result) {
      events.push({ type: 'exit', method, result });
    },
    __ft_exit_error(ctx, module_, cls, method, visibility, paramNames, args, err) {
      events.push({ type: 'exit_error', method, err });
    },
    __ft_run(ctx, fn) {
      return fn();
    },
  };
}

// ── test 1: basic CJS class ──────────────────────────────────

test('transform: CJS class methods produce enter/exit events', () => {
  const source = `
class Calc {
  add(a, b) { return a + b; }
  sub(a, b) { return a - b; }
}
module.exports = { Calc };
`;
  const runtimePath = '__ft_runtime__';
  const { code } = transform(source, { filename: '/test/calc.js', moduleType: 'cjs', runtimePath });

  assert.ok(code.includes('__ft_enter'), 'should contain __ft_enter');
  assert.ok(code.includes('__ft_exit'), 'should contain __ft_exit');
  assert.ok(code.includes('__ft_run'), 'should contain __ft_run');

  const { exports, events } = evalCjs(code, runtimePath);

  const calc = new exports.Calc();
  const result = calc.add(2, 3);
  assert.equal(result, 5, 'add should return 5');

  const enters = events.filter(e => e.type === 'enter');
  const exits  = events.filter(e => e.type === 'exit');
  assert.ok(enters.length >= 1, 'at least one enter event');
  assert.equal(enters[0].method, 'add');
  assert.equal(enters[0].visibility, 'public');
  assert.ok(exits.length >= 1, 'at least one exit event');
});

// ── test 2: arrow function with concise body ─────────────────

test('transform: arrow function with concise body is wrapped', () => {
  const source = `const double = x => x * 2; module.exports = { double };`;
  const runtimePath = '__ft_runtime__';
  const { code } = transform(source, { filename: '/test/arrows.js', moduleType: 'cjs', runtimePath });

  assert.ok(code.includes('__ft_enter'), 'arrow: contains __ft_enter');

  const { exports, events } = evalCjs(code, runtimePath);
  const res = exports.double(7);
  assert.equal(res, 14, 'double(7) should be 14');

  const enters = events.filter(e => e.type === 'enter');
  assert.ok(enters.length >= 1, 'arrow enter event emitted');
});

// ── test 3: visibility of private class methods ──────────────

test('transform: private class method (#m) visibility is "private"', () => {
  const source = `
class Foo {
  run() { return this.#helper(); }
  #helper() { return 42; }
}
module.exports = { Foo };
`;
  const runtimePath = '__ft_runtime__';
  const { code } = transform(source, { filename: '/test/priv.js', moduleType: 'cjs', runtimePath });

  const { exports, events } = evalCjs(code, runtimePath);
  const foo = new exports.Foo();
  foo.run();

  const helperEnter = events.find(e => e.type === 'enter' && e.method === '#helper');
  assert.ok(helperEnter, '#helper enter event should exist');
  assert.equal(helperEnter.visibility, 'private', '#helper should be private');

  const runEnter = events.find(e => e.type === 'enter' && e.method === 'run');
  assert.ok(runEnter, 'run enter event should exist');
  assert.equal(runEnter.visibility, 'public', 'run should be public');
});

// ── test 4: constructor is skipped ───────────────────────────

test('transform: constructor is NOT instrumented', () => {
  const source = `
class Bar {
  constructor(x) { this.x = x; }
  getX() { return this.x; }
}
module.exports = { Bar };
`;
  const runtimePath = '__ft_runtime__';
  const { code } = transform(source, { filename: '/test/ctor.js', moduleType: 'cjs', runtimePath });

  const { exports, events } = evalCjs(code, runtimePath);
  new exports.Bar(99);

  const ctorEvent = events.find(e => e.method === 'constructor');
  assert.equal(ctorEvent, undefined, 'constructor should not be instrumented');
});

// ── test 5: error path ───────────────────────────────────────

test('transform: thrown error triggers __ft_exit_error', () => {
  const source = `
class Thrower {
  boom() { throw new Error('kaboom'); }
}
module.exports = { Thrower };
`;
  const runtimePath = '__ft_runtime__';
  const { code } = transform(source, { filename: '/test/err.js', moduleType: 'cjs', runtimePath });

  const { exports, events } = evalCjs(code, runtimePath);
  const t = new exports.Thrower();
  assert.throws(() => t.boom(), /kaboom/);

  const errEvent = events.find(e => e.type === 'exit_error' && e.method === 'boom');
  assert.ok(errEvent, 'exit_error event should be emitted on throw');
});

// ── test 6: async function ───────────────────────────────────

test('transform: async function is instrumented correctly', async () => {
  const source = `
async function fetchData(id) { return id * 2; }
module.exports = { fetchData };
`;
  const runtimePath = '__ft_runtime__';

  // async __ft_run stub
  const events = [];
  const stubs = {
    [runtimePath]: {
      __ft_enter(mod, cls, method, visibility, paramNames, args) {
        events.push({ type: 'enter', method });
        return { id: 1, start: process.hrtime.bigint() };
      },
      __ft_exit(ctx, mod, cls, method, visibility, paramNames, args, result) {
        events.push({ type: 'exit', method, result });
      },
      __ft_exit_error(ctx, mod, cls, method, visibility, paramNames, args, err) {
        events.push({ type: 'exit_error', method });
      },
      async __ft_run(ctx, fn) { return fn(); },
    },
  };

  const { code } = transform(source, { filename: '/test/async.js', moduleType: 'cjs', runtimePath });

  const _req = (id) => stubs[id] ?? (() => { throw new Error(`no stub: ${id}`); })();
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', code); // eslint-disable-line no-new-func
  const mod = { exports: {} };
  fn(_req, mod, mod.exports, '/test', '/test/async.js');

  const result = await mod.exports.fetchData(21);
  assert.equal(result, 42, 'async function should return 42');
  assert.ok(events.some(e => e.type === 'enter' && e.method === 'fetchData'), 'enter emitted for async fn');
});
