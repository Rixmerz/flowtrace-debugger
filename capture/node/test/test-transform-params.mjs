/**
 * Transform edge cases around parameters, return capture and what gets
 * instrumented. Each case is executed, not just generated: the shipped bug
 * this guards against produced syntactically valid code that only failed when
 * the function was called.
 *
 * Runs with: node --test test/test-transform-params.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, langForFile } from '../src/transform/swc.js';

const RUNTIME = '__ft_runtime__';

/** Stub helpers that record events instead of writing a file. */
function makeStubs(events) {
  return {
    __ft_enter(module_, cls, method, visibility, paramNames, args, lang) {
      const named = {};
      for (let i = 0; i < args.length; i++) named[paramNames[i] ?? `arg${i}`] = args[i];
      events.push({ event: 'enter', module: module_, cls, method, visibility, args: named, lang });
      return { module_, method };
    },
    __ft_exit(ctx, module_, cls, method, visibility, paramNames, args, result, lang) {
      events.push({ event: 'exit', method, result, lang });
    },
    __ft_exit_error(ctx, module_, cls, method, visibility, paramNames, args, err, lang) {
      events.push({ event: 'exit', method, error: err, lang });
    },
    __ft_run(ctx, fn) {
      return fn();
    },
  };
}

/** Transform `source` as CJS and evaluate it; returns module.exports + events. */
function run(source, filename = '/app/fixture.js') {
  const { code } = transform(source, { filename, moduleType: 'cjs', runtimePath: RUNTIME });
  const events = [];
  const stubs = makeStubs(events);
  const module = { exports: {} };
  const req = (id) => {
    if (id === RUNTIME) return stubs;
    throw new Error(`unexpected require(${id})`);
  };
  new Function('require', 'module', 'exports', code)(req, module, module.exports);
  return { exports: module.exports, events, code };
}

test('arrow with an object-pattern parameter runs and captures the object', () => {
  const { exports: f, events } = run('const f = ({a, b}) => a + b; module.exports = f;');
  assert.equal(f({ a: 1, b: 2 }), 3);
  assert.deepEqual(events[0].args, { arg0: { a: 1, b: 2 } });
  assert.equal(events[1].result, 3);
});

test('arrow with an array-pattern parameter', () => {
  const { exports: g } = run('const g = ([x, y]) => x * y; module.exports = g;');
  assert.equal(g([3, 4]), 12);
});

test('arrow with a defaulted pattern keeps the default semantics', () => {
  const { exports: h, events } = run('const h = ({a} = {a: 7}) => a; module.exports = h;');
  assert.equal(h(), 7);
  assert.equal(h({ a: 1 }), 1);
  assert.deepEqual(events[0].args, { arg0: { a: 7 } }, 'the default value is what was captured');
});

test('arrow with a rest pattern and a later default referencing an earlier param', () => {
  const { exports: r } = run(
    'const r = (first, {b = first} = {}, ...[third]) => [first, b, third]; module.exports = r;'
  );
  assert.deepEqual(r(1, undefined, 3), [1, 1, 3]);
  assert.deepEqual(r(1, { b: 2 }, 3), [1, 2, 3]);
});

test('a body that re-declares a destructured name with var still compiles', () => {
  const { exports: k } = run('const k = ({a}) => { var a = 5; return a; }; module.exports = k;');
  assert.equal(k({ a: 1 }), 5);
});

test('async arrow with a destructured parameter', async () => {
  const { exports: a } = run('const a = async ({n}) => n * 2; module.exports = a;');
  assert.equal(await a({ n: 21 }), 42);
});

test('return inside a loop and a switch is captured as the result', () => {
  const { exports, events } = run(`
    function loop(n) { for (let i = 0; i < n; i++) { if (i === 2) return i * 10; } return -1; }
    function sw(x) { switch (x) { case 1: return 'one'; default: return 'other'; } }
    module.exports = { loop, sw };
  `);
  assert.equal(exports.loop(5), 20);
  assert.equal(exports.sw(1), 'one');
  const exits = events.filter((e) => e.event === 'exit');
  assert.deepEqual(exits.map((e) => e.result), [20, 'one']);
});

test('return inside try/finally is captured', () => {
  const { exports: f, events } = run(
    'function f() { try { return "t"; } finally { globalThis.__ft_fin = true; } } module.exports = f;'
  );
  assert.equal(f(), 't');
  assert.equal(events[1].result, 't');
});

test('object-literal methods are instrumented; getters are not', () => {
  const { exports: o, events } = run(`
    const o = { greet(name) { return 'hi ' + name; }, get size() { return 1; } };
    module.exports = o;
  `);
  assert.equal(o.greet('x'), 'hi x');
  assert.equal(o.size, 1);
  assert.deepEqual(events.map((e) => e.method), ['greet', 'greet']);
  assert.deepEqual(events[0].args, { name: 'x' });
});

test('lang is "ts" for TypeScript sources and "node" otherwise', () => {
  assert.equal(langForFile('/x/a.ts'), 'ts');
  assert.equal(langForFile('/x/a.tsx'), 'ts');
  assert.equal(langForFile('/x/a.mts'), 'ts');
  assert.equal(langForFile('/x/a.cts'), 'ts');
  assert.equal(langForFile('/x/a.js'), 'node');
  assert.equal(langForFile('/x/a.mjs'), 'node');

  const ts = run('export function add(a: number, b: number): number { return a + b; }', '/app/calc.ts');
  assert.equal(ts.exports.add(1, 2), 3);
  assert.equal(ts.events[0].lang, 'ts');
  assert.equal(ts.events[1].lang, 'ts');

  const js = run('function add(a, b) { return a + b; } add(1, 2);', '/app/calc.js');
  assert.equal(js.events[0].lang, 'node');
});
