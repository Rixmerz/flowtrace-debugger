/**
 * Generator functions are not instrumented — and the user must be told.
 *
 * The transform wraps each function body in an inner ARROW function, and an arrow
 * cannot contain `yield`, so generators are skipped. That is a real limitation
 * (see the long comment on buildInstrumentedBody for the three ways out and what
 * each costs), but it used to be applied in total silence: a generator-heavy
 * module produced no events for any of them and nothing distinguished
 * "never called" from "never instrumented".
 *
 * Python has no such gap — its transformer rewrites bodies in place, so
 * generators work there for free. These tests pin the Node behaviour and, more
 * importantly, pin the diagnostic, including the fact that it must survive a warm
 * transform cache.
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
const FIXTURES = join(__dirname, 'fixtures/async');

function run(entry) {
  const outDir = join(
    tmpdir(),
    `ft-gen-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');

  try {
    const result = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, entry], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '',
        NODE_OPTIONS: '',
      },
      cwd: FIXTURES,
      timeout: 30000,
      encoding: 'utf8',
    });
    const events = existsSync(outPath)
      ? readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    return { ...result, events };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test('a skipped generator is reported on stderr, naming the function', () => {
  const { stderr } = run('a.mjs');

  assert.match(stderr ?? '', /not instrumenting 1 generator function/);
  assert.match(stderr ?? '', /\bgen\b/, 'the diagnostic must name the function');
  assert.match(stderr ?? '', /absent from the trace/, 'it must say what the consequence is');
});

test('the diagnostic survives a warm transform cache', () => {
  // The cache is keyed on source content, so a hit skips the transform entirely.
  // Files with skipped generators are therefore left uncached on purpose —
  // otherwise the answer to "why is my generator missing" appears once, on a
  // machine that has never run the file, and never again.
  const first = run('a.mjs');
  const second = run('a.mjs');
  const third = run('a.mjs');

  for (const [i, r] of [first, second, third].entries()) {
    assert.match(
      r.stderr ?? '',
      /not instrumenting 1 generator function/,
      `run ${i + 1} produced no diagnostic — the cache swallowed it`
    );
  }
});

test('skipping the generator does not break it or the rest of the file', () => {
  const { stdout, stderr, events } = run('a.mjs');

  // The generator still works — declining to instrument must be inert.
  assert.match(stdout ?? '', /gen \[ 1, 2 \]/, `stderr:\n${stderr}`);
  // ...and the non-generator functions in the same file are still traced.
  assert.ok(
    events.some((e) => e.method === 'slow'),
    'the async function in the same file was not traced'
  );
  assert.ok(
    !events.some((e) => e.method === 'gen'),
    'gen should not appear in the trace while it is unsupported'
  );
});

test('async functions report the awaited duration and the resolved value', () => {
  // Not a generator concern, but the same fixture proves it: the transform awaits
  // __ft_run for async functions, so duration covers the awaited work and result
  // is the resolved value rather than a pending Promise.
  const { events } = run('a.mjs');

  const exit = events.find((e) => e.method === 'slow' && e.event === 'exit');
  assert.ok(exit, 'no exit event for the async function');
  assert.deepEqual(exit.result, { value: 'done-60' }, 'result must be the resolved value');
  assert.ok(
    exit.duration_ns > 50_000_000,
    `duration ${exit.duration_ns}ns should cover the awaited 60ms sleep`
  );
});
