/**
 * `file` / `line` on enter events (schema v2, optional).
 *
 * They exist so a static indexer can join a runtime span to the symbol that
 * declares the function, so what matters is that they name the declaration as
 * written on disk — for TypeScript the .ts file, whose lines are NOT the lines
 * of the stripped code the instrumentation is applied to.
 *
 * Runs with: node --test test/test-source-location.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '../src/transform/swc.js';
import { sourceFileFor, projectRoot, originalLineLookup } from '../src/transform/source-location.js';
import { cacheKey } from '../src/cache/index.js';
import { init } from '../src/runtime/emitter.js';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const BOOTSTRAP = fileURLToPath(new URL('../src/bootstrap.mjs', import.meta.url));

// ── helpers ──────────────────────────────────────────────────

/** 1-indexed line of the single line containing `needle` — the ground truth. */
function lineOf(source, needle) {
  const hits = source.split('\n').map((text, i) => (text.includes(needle) ? i + 1 : 0)).filter(Boolean);
  assert.equal(hits.length, 1, `${JSON.stringify(needle)} must appear on exactly one line, got ${hits}`);
  return hits[0];
}

/**
 * Every `__ft_enter(...)` call in transformed code, read back from its AST:
 * `{ "<class>.<method>": { file, line } }` (`file`/`line` undefined if absent).
 */
function enterCalls(code) {
  const ast = parser.parse(code, { sourceType: 'unambiguous', plugins: ['classPrivateMethods', 'classProperties'] });
  const out = {};
  traverse(ast, {
    CallExpression(path) {
      if (path.node.callee.name !== '__ft_enter') return;
      const a = path.node.arguments;
      const cls = a[1].type === 'NullLiteral' ? '' : a[1].value;
      const key = cls ? `${cls}.${a[2].value}` : a[2].value;
      assert.ok(!(key in out), `duplicate function ${key} in test source`);
      assert.ok(a.length === 7 || a.length === 9, `__ft_enter takes 7 or 9 arguments, got ${a.length}`);
      out[key] = { file: a[7]?.value, line: a[8]?.value };
    },
  });
  return out;
}

function locations(source, filename, opts = {}) {
  const { code } = transform(source, { filename, runtimePath: '__rt__', root: '/proj', ...opts });
  return enterCalls(code);
}

// A JavaScript source. Non-ASCII text sits before the functions and on the
// same line as one of them: a position computed in bytes instead of in
// characters lands on the wrong line here.
const JS_SOURCE = `// héllo wörld — 日本語のコメント 🎉🎉🎉
'use strict';
const banner = "ñandú — 日本語 🎉";

/**
 * A doc comment, so the declaration is not on the line after the last one.
 */
function plain(a) {
  function nestedDecl() { return 1; }
  return a;
}

async function asyncPlain() {
  return 1;
}

class Service {
  constructor() { this.x = 1; }

  method(a) {
    return a;
  }

  static async build() {
    return new Service();
  }

  #hidden(x) {
    return x;
  }
}

const emoji = "🎉🎉🎉"; const sameLineArrow = (x) => x * 2;

const multiLineArrow =
  async (y) => {
    return y;
  };

const expr = function namedExpr() {};

const obj = {
  objMethod(a) { return a; },
};

module.exports = { plain, asyncPlain, Service, sameLineArrow, multiLineArrow, expr, obj };
`;

const JS_EXPECTED = {
  plain: 'function plain(a)',
  asyncPlain: 'async function asyncPlain()',
  'Service.method': '  method(a) {',
  'Service.build': 'static async build()',
  'Service.#hidden': '#hidden(x) {',
  sameLineArrow: 'const sameLineArrow =',
  // The arrow's own line, not the line of the `const` it is assigned to.
  multiLineArrow: 'async (y) => {',
  namedExpr: 'function namedExpr()',
  objMethod: 'objMethod(a) {',
};

// A TypeScript source. Interfaces, type aliases and blank lines disappear from
// the code that actually gets instrumented, so every function below sits on a
// different line there than in this file.
const TS_SOURCE = `// héllo wörld — 日本語のコメント 🎉🎉🎉
import { EventEmitter } from 'node:events';

interface Shape {
  area(): number;
  name: string;
}

type Id = string | number;

const banner: string = "ñandú — 日本語 🎉";

/** Doc comment. */
export async function fetchThing(id: Id): Promise<Id> {
  return id;
}

export function plain(
  a: number,
  b: number,
): number {
  return a + b;
}

export class Circle extends EventEmitter implements Shape {
  name = 'circle';
  private readonly r: number;

  constructor(r: number) {
    super();
    this.r = r;
  }

  area(): number {
    return Math.PI * this.r ** 2;
  }

  static async unit(): Promise<Circle> {
    return new Circle(1);
  }

  #secret<T>(x: T): T {
    return x;
  }

  private tsPrivate(): void {}
}

const emoji: string = "🎉🎉🎉"; export const sameLineArrow = (x: number): number => x * 2;

export const multiLineArrow =
  async <T,>(y: T): Promise<T> => {
    return y;
  };

export const obj = {
  objMethod(a: number): number { return a; },
};
`;

const TS_EXPECTED = {
  fetchThing: 'export async function fetchThing(',
  plain: 'export function plain(',
  'Circle.area': '  area(): number {',
  'Circle.unit': 'static async unit()',
  'Circle.#secret': '#secret<T>(x: T): T {',
  'Circle.tsPrivate': 'private tsPrivate(): void {}',
  sameLineArrow: 'export const sameLineArrow =',
  multiLineArrow: 'async <T,>(y: T): Promise<T> => {',
  objMethod: 'objMethod(a: number): number {',
};

function assertLocations(got, source, expected, file) {
  for (const [name, needle] of Object.entries(expected)) {
    assert.ok(got[name], `${name} was not instrumented`);
    assert.deepEqual(got[name], { file, line: lineOf(source, needle) }, name);
  }
}

// ── transform: which line ────────────────────────────────────

test('JavaScript: line is the declaration line in the source as written', () => {
  for (const moduleType of ['cjs', 'esm']) {
    const got = locations(JS_SOURCE, '/proj/src/service.js', { moduleType });
    assertLocations(got, JS_SOURCE, JS_EXPECTED, 'src/service.js');
  }
});

test('TypeScript: line is the line in the .ts file, not in the stripped code', () => {
  for (const moduleType of ['cjs', 'esm']) {
    const got = locations(TS_SOURCE, '/proj/src/shapes.ts', { moduleType });
    assertLocations(got, TS_SOURCE, TS_EXPECTED, 'src/shapes.ts');
  }
});

test('TypeScript: the stripped code really does shift lines (the test would pass vacuously otherwise)', () => {
  const { code } = transform(TS_SOURCE, { filename: '/proj/src/shapes.ts', moduleType: 'esm', runtimePath: '__rt__', root: '/proj' });
  const got = enterCalls(code);
  const generatedLine = code.split('\n').findIndex((l) => l.includes('async function fetchThing')) + 1;
  assert.ok(generatedLine > 0);
  assert.notEqual(generatedLine, got.fetchThing.line);
});

test('a second, third and fourth file transformed in the same process keep their own lines', () => {
  // swc's span offsets keep growing across parse calls within one process, so
  // anything derived from them is right for the first file only. Interleave
  // TypeScript and JavaScript, with a different amount of leading text each
  // time, and transform the first file again at the end.
  const padded = (n, body) => `${'// padding — ñ 日本語 🎉\n'.repeat(n)}${body}`;
  const rounds = [
    ['/proj/a.ts', padded(0, TS_SOURCE), TS_EXPECTED],
    ['/proj/b.ts', padded(7, TS_SOURCE), TS_EXPECTED],
    ['/proj/c.js', padded(3, JS_SOURCE), JS_EXPECTED],
    ['/proj/d.ts', padded(41, TS_SOURCE), TS_EXPECTED],
    ['/proj/a.ts', padded(0, TS_SOURCE), TS_EXPECTED],
  ];
  for (const [filename, source, expected] of rounds) {
    assertLocations(locations(source, filename, { moduleType: 'esm' }), source, expected, filename.slice('/proj/'.length));
  }
});

test('non-ASCII text on the same generated line as a function does not move it', () => {
  const source = [
    'type T = number;',
    '',
    'const o = { "日本語🎉": 1, "ключ": (a: T): T => a }; function after(): void {}',
    'export { o, after };',
    '',
  ].join('\n');
  const got = locations(source, '/proj/x.ts', { moduleType: 'esm' });
  assert.deepEqual(got.after, { file: 'x.ts', line: 3 });
  assert.deepEqual(got['<anonymous>'], { file: 'x.ts', line: 3 });
});

test('CRLF sources count lines the way an editor does', () => {
  const source = 'const a = 1;\r\n\r\nfunction f() {}\r\nmodule.exports = { f };\r\n';
  assert.deepEqual(locations(source, '/proj/crlf.js').f, { file: 'crlf.js', line: 3 });
});

test('code the compiler synthesized has no location rather than a guessed one', () => {
  // On the CommonJS path swc emits an `_export` helper that exists in no
  // source file; it is instrumented like any function, but there is no
  // declaration to point at.
  const got = locations(TS_SOURCE, '/proj/src/shapes.ts', { moduleType: 'cjs' });
  assert.ok(got._export, 'expected swc to emit its _export helper (update this test if it no longer does)');
  assert.deepEqual(got._export, { file: undefined, line: undefined });
});

test('no real filename means no location', () => {
  const { code } = transform('function f() {}', { runtimePath: '__rt__' });
  assert.deepEqual(enterCalls(code).f, { file: undefined, line: undefined });
});

test('originalLineLookup: unknown positions are null, not a neighbouring line', () => {
  // Line 1: nothing. Line 2: one segment at column 4 -> original line 10 (0-based 9).
  const lookup = originalLineLookup({ mappings: ';IASA' });
  assert.equal(lookup(1, 0), null);
  assert.equal(lookup(2, 0), null, 'before the first segment of the line');
  assert.equal(lookup(2, 4), 10);
  assert.equal(lookup(2, 40), 10);
  assert.equal(lookup(3, 0), null);
});

// ── which file ───────────────────────────────────────────────

test('file is POSIX, relative to the root; absolute when outside it', () => {
  assert.equal(sourceFileFor('/proj/src/a/b.ts', '/proj'), 'src/a/b.ts');
  assert.equal(sourceFileFor('/elsewhere/b.ts', '/proj'), '/elsewhere/b.ts');
  // A sibling that merely shares a name prefix is outside.
  assert.equal(sourceFileFor('/proj-old/b.ts', '/proj'), '/proj-old/b.ts');
  assert.equal(sourceFileFor('<unknown>', '/proj'), null);

  const got = locations(JS_SOURCE, '/elsewhere/service.js', { moduleType: 'cjs' });
  assert.deepEqual(got.plain, { file: '/elsewhere/service.js', line: lineOf(JS_SOURCE, 'function plain(a)') });
});

test('FLOWTRACE_ROOT overrides the cwd', () => {
  const saved = process.env.FLOWTRACE_ROOT;
  try {
    delete process.env.FLOWTRACE_ROOT;
    assert.equal(projectRoot(), process.cwd());
    const inCwd = join(process.cwd(), 'sub', 'f.js');
    assert.equal(sourceFileFor(inCwd), 'sub/f.js');

    process.env.FLOWTRACE_ROOT = join(process.cwd(), 'sub');
    assert.equal(sourceFileFor(inCwd), 'f.js');
    assert.deepEqual(
      enterCalls(transform('function f() {}', { filename: inCwd, runtimePath: '__rt__' }).code).f,
      { file: 'f.js', line: 1 },
    );

    // A relative value is resolved against the starting cwd.
    process.env.FLOWTRACE_ROOT = '..';
    assert.equal(projectRoot(), join(process.cwd(), '..'));
  } finally {
    if (saved === undefined) delete process.env.FLOWTRACE_ROOT; else process.env.FLOWTRACE_ROOT = saved;
  }
});

test('a root reached through a symlink still yields a relative path', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ft-loc-')));
  try {
    mkdirSync(join(dir, 'real', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'real', 'pkg', 'm.js'), '');
    try {
      symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir');
    } catch {
      t.skip('symlinks not available');
      return;
    }
    assert.equal(sourceFileFor(join(dir, 'real', 'pkg', 'm.js'), join(dir, 'link')), 'pkg/m.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the transform cache is keyed on the root the file path was made relative to', () => {
  const base = { filename: '/proj/a.js', moduleType: 'cjs', runtimePath: '/rt.js' };
  assert.notEqual(cacheKey('x', { ...base, root: '/proj' }), cacheKey('x', { ...base, root: '/' }));
});

// ── runtime: the event ───────────────────────────────────────

test('enter carries file and line as its last keys; exit never does; neither is redacted or truncated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-loc-'));
  const out = join(dir, 'trace.jsonl');
  const saved = { max: process.env.FLOWTRACE_MAX_ARG_LENGTH, redact: process.env.FLOWTRACE_REDACT_KEYS };
  process.env.FLOWTRACE_MAX_ARG_LENGTH = '8';
  process.env.FLOWTRACE_REDACT_KEYS = 'file,line';
  try {
    const mod = await import('../src/runtime/instrument.js?source-location');
    mod._resetConfigForTests();
    init(out);
    const file = 'src/secret_token_service/password_url_email_authorization.ts';
    const params = ['token', 'long'];
    const args = ['t', 'x'.repeat(100)];

    let ctx = mod.__ft_enter('m', 'C', 'ok', 'public', params, args, 'ts', file, 42);
    mod.__ft_exit(ctx, 'm', 'C', 'ok', 'public', params, args, 1, 'ts');
    ctx = mod.__ft_enter('m', 'C', 'fails', 'public', [], [], 'ts', file, 50);
    mod.__ft_exit_error(ctx, 'm', 'C', 'fails', 'public', [], [], new Error('boom'), 'ts');
    // A manual caller that predates the two parameters.
    ctx = mod.__ft_enter('m', null, 'manual', 'public', [], []);
    mod.__ft_exit(ctx, 'm', null, 'manual', 'public', [], [], undefined);

    const events = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const [enterOk, exitOk, enterFails, exitFails, enterManual] = events;
    assert.equal(events.length, 6);

    assert.deepEqual(Object.keys(enterOk).slice(-3), ['depth', 'file', 'line']);
    assert.equal(enterOk.file, file);
    assert.equal(enterOk.line, 42);
    assert.equal(enterOk.args.token, '<redacted>');
    assert.match(enterOk.args.long, /^<truncated:/);
    assert.equal(enterFails.line, 50);

    for (const exit of [exitOk, exitFails]) {
      assert.equal(exit.event, 'exit');
      assert.ok(!('file' in exit) && !('line' in exit), 'exit events are unchanged');
    }
    assert.ok(!('file' in enterManual) && !('line' in enterManual), 'both are optional');
    assert.equal(enterManual.lang, 'node');
  } finally {
    for (const [k, v] of [['FLOWTRACE_MAX_ARG_LENGTH', saved.max], ['FLOWTRACE_REDACT_KEYS', saved.redact]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── end to end: the real hooks, in a real process ────────────

/** A scratch project with a CJS file, an ESM file and a TypeScript file. */
function scratchProject() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ft-loc-e2e-')));
  const root = join(base, 'project');
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  writeFileSync(join(root, 'src', 'lib', 'service.cjs'), JS_SOURCE);
  writeFileSync(join(root, 'src', 'shapes.ts'), TS_SOURCE);
  const main = `// entry — 日本語 🎉
import { createRequire } from 'node:module';
import { Circle, fetchThing } from './src/shapes.ts';
const require = createRequire(import.meta.url);
const { plain, Service } = require('./src/lib/service.cjs');

async function main() {
  plain(1);
  new Service().method(2);
  new Circle(2).area();
  await fetchThing('id');
}

await main();
`;
  writeFileSync(join(root, 'main.mjs'), main);
  return { base, root, main };
}

function trace({ base, root }, env = {}, name = 'trace') {
  const out = join(base, `${name}.jsonl`);
  const childEnv = {
    ...process.env,
    FLOWTRACE_OUTPUT: out,
    FLOWTRACE_PACKAGE_PREFIX: root,
    NODE_OPTIONS: '',
    // A private transform cache shared by every run of one test: that is what
    // makes "same files, another root" a real test of the cache key.
    HOME: join(base, 'home'),
    USERPROFILE: join(base, 'home'),
    ...env,
  };
  if (!('FLOWTRACE_ROOT' in env)) delete childEnv.FLOWTRACE_ROOT;
  const r = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, 'main.mjs'], {
    cwd: root, env: childEnv, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const enterOf = (events, method) => events.find((e) => e.event === 'enter' && e.method === method);

test('e2e: CJS, ESM and TypeScript files report their own file and declaration line', () => {
  const project = scratchProject();
  try {
    const events = trace(project);

    assert.deepEqual(
      [enterOf(events, 'main').file, enterOf(events, 'main').line],
      ['main.mjs', lineOf(project.main, 'async function main()')],
    );
    const plain = enterOf(events, 'plain');
    assert.equal(plain.lang, 'node');
    assert.deepEqual([plain.file, plain.line], ['src/lib/service.cjs', lineOf(JS_SOURCE, 'function plain(a)')]);
    const method = enterOf(events, 'method');
    assert.deepEqual([method.file, method.line], ['src/lib/service.cjs', lineOf(JS_SOURCE, '  method(a) {')]);

    const area = enterOf(events, 'area');
    assert.equal(area.lang, 'ts');
    assert.deepEqual([area.file, area.line], ['src/shapes.ts', lineOf(TS_SOURCE, '  area(): number {')]);
    const fetchThing = enterOf(events, 'fetchThing');
    assert.deepEqual(
      [fetchThing.file, fetchThing.line],
      ['src/shapes.ts', lineOf(TS_SOURCE, 'export async function fetchThing(')],
    );

    for (const e of events) {
      if (e.event === 'enter') {
        assert.deepEqual(Object.keys(e).slice(-3), ['depth', 'file', 'line'], `${e.method} enter`);
      } else {
        assert.ok(!('file' in e) && !('line' in e), `${e.method} exit`);
      }
    }
  } finally {
    rmSync(project.base, { recursive: true, force: true });
  }
});

test('e2e: FLOWTRACE_ROOT re-bases file, and a file outside it is absolute', () => {
  const project = scratchProject();
  try {
    // Same sources, same cache directory, three different roots.
    const fromCwd = trace(project, {}, 'a');
    const fromParent = trace(project, { FLOWTRACE_ROOT: project.base }, 'b');
    const elsewhere = join(project.base, 'elsewhere');
    mkdirSync(elsewhere);
    const outside = trace(project, { FLOWTRACE_ROOT: elsewhere }, 'c');

    assert.equal(enterOf(fromCwd, 'area').file, 'src/shapes.ts');
    assert.equal(enterOf(fromParent, 'area').file, 'project/src/shapes.ts');
    assert.equal(enterOf(fromParent, 'plain').file, 'project/src/lib/service.cjs');
    assert.equal(enterOf(fromParent, 'main').file, 'project/main.mjs');

    const abs = enterOf(outside, 'area').file;
    assert.ok(isAbsolute(abs), abs);
    assert.ok(!abs.includes('\\'), abs);
    assert.equal(abs.split('/').join('/'), join(project.root, 'src', 'shapes.ts').split('\\').join('/'));
    // The line is a property of the file, not of the root.
    assert.equal(enterOf(outside, 'area').line, enterOf(fromCwd, 'area').line);
  } finally {
    rmSync(project.base, { recursive: true, force: true });
  }
});
