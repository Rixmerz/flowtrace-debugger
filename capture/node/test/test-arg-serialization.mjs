/**
 * Argument and result serialization for values JSON cannot represent.
 *
 * The previous implementation was `JSON.parse(JSON.stringify(v))` with a
 * `String(v)` fallback, and the fallback only ran for values that made stringify
 * THROW. Values it merely had no representation for were silently mangled:
 *
 *   Error  -> {}                      (no enumerable own properties)
 *   Map    -> {}
 *   Set    -> {}
 *   fn     -> its full source text, which after instrumentation contains
 *             FlowTrace's own injected __ft_enter / __ft_run scaffolding
 *   undefined -> the string "undefined"
 *   NaN / Infinity -> null, indistinguishable from a real null
 *   circular -> "[object Object]", every field gone
 *
 * Python's serializer already produced informative output for the equivalents, so
 * this was a cross-language divergence too: the same argument traced in two
 * languages disagreed about what it was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');
const FIXTURES = join(__dirname, 'fixtures/args');

/** Every `take(v)` argument in order, as serialized. */
function serializedArgs() {
  const outDir = join(
    tmpdir(),
    `ft-args-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');
  try {
    const result = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, 'a.mjs'], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '',
        NODE_OPTIONS: '',
        // Generous, so truncation does not mask what the serializer produced.
        FLOWTRACE_MAX_ARG_LENGTH: '4096',
      },
      cwd: FIXTURES,
      timeout: 30000,
      encoding: 'utf8',
    });
    assert.ok(existsSync(outPath), `no trace emitted. stderr:\n${result.stderr}`);
    const events = readFileSync(outPath, 'utf8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    return events.filter((e) => e.event === 'enter' && e.method === 'take').map((e) => e.args.v);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// Order matches the take(...) calls in fixtures/args/a.mjs.
const [
  UNDEF, NUL, ERR, MAP, SET, DATE, BIG, SYM, FN, CIRC, INST, NAN, INF,
] = serializedArgs();

test('undefined and null both serialize to null, not the string "undefined"', () => {
  assert.equal(UNDEF, null);
  assert.equal(NUL, null);
});

test('an Error keeps its name and message instead of collapsing to {}', () => {
  assert.deepEqual(ERR, { name: 'Error', message: 'boom' });
});

test('Map and Set keep their contents instead of collapsing to {}', () => {
  assert.deepEqual(MAP, { a: 1 });
  assert.deepEqual(SET, [1, 2]);
});

test('a function serializes to its name, never its source', () => {
  assert.equal(FN, '<function named>');
  // The regression guard that matters: the old behaviour leaked our own
  // injected scaffolding into the user's trace.
  assert.ok(!String(FN).includes('__ft_enter'), 'function source leaked into the trace');
  assert.ok(!String(FN).includes('__ft_run'), 'function source leaked into the trace');
});

test('a circular object keeps its readable fields and marks the cycle', () => {
  assert.deepEqual(CIRC, { name: 'loop', self: '<circular>' });
});

test('NaN and Infinity stay distinguishable from null', () => {
  // JSON has no representation for either, and stringify turns both into null.
  assert.equal(NAN, 'NaN');
  assert.equal(INF, 'Infinity');
});

test('Date, BigInt and Symbol serialize informatively', () => {
  assert.equal(DATE, '2020-01-02T03:04:05.000Z');
  assert.equal(BIG, '10n');
  assert.equal(SYM, 'Symbol(sym)');
});

test('a plain class instance keeps its fields', () => {
  assert.deepEqual(INST, { x: 7 });
});

test('every serialized argument survives a JSON round-trip', () => {
  // The whole point: the emitted line must be parseable by the JavaScript
  // consumers. Python was emitting bare NaN/Infinity, which JSON.parse rejects.
  for (const value of serializedArgs()) {
    assert.doesNotThrow(
      () => JSON.parse(JSON.stringify({ v: value })),
      `value ${String(value)} does not round-trip`
    );
  }
});
