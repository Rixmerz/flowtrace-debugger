/**
 * Subprocess (env carrier) propagation integration tests.
 *
 * A parent spawns a traced child; the child's root span must join the parent's
 * trace and be parented to the span that did the spawning.
 *
 * Both ESM import styles are exercised deliberately. Node builds a builtin's
 * ESM facade by snapshotting its CJS exports the first time that builtin is
 * imported as ESM, so a monkeypatch applied *after* facade creation is invisible
 * to `import { spawnSync } from 'node:child_process'` while remaining visible to
 * `import cp from 'node:child_process'; cp.spawnSync()`. src/runtime/subprocess.js
 * avoids that by patching through createRequire; these two tests are the
 * regression guard, since the failure mode is silent (no error, just a lost
 * trace link).
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
const FIXTURES = join(__dirname, 'fixtures/propagation');
const CHILD = join(FIXTURES, 'spawn-child.mjs');

function readEvents(path) {
  assert.ok(existsSync(path), `expected trace output at ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * Run a parent fixture that spawns CHILD, and return both event streams.
 * @param {string} parentFixture - filename inside fixtures/propagation
 */
function runParent(parentFixture) {
  const outDir = join(
    tmpdir(),
    `ft-spawn-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const parentOut = join(outDir, 'parent.jsonl');
  const childOut = join(outDir, 'child.jsonl');

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', `file://${BOOTSTRAP}`, join(FIXTURES, parentFixture), CHILD, childOut],
      {
        env: {
          ...process.env,
          FLOWTRACE_OUTPUT: parentOut,
          FLOWTRACE_PACKAGE_PREFIX: '',
          NODE_OPTIONS: '',
          // Ensure a stale carrier in the developer's shell cannot mask a
          // regression by making the assertions pass for the wrong reason.
          FLOWTRACE_TRACEPARENT: '',
        },
        cwd: FIXTURES,
        timeout: 30000,
        encoding: 'utf8',
      }
    );

    assert.match(
      result.stdout ?? '',
      /status=0/,
      `parent failed to run child. stderr:\n${result.stderr}`
    );

    return {
      parentEvents: readEvents(parentOut),
      childEvents: readEvents(childOut),
      stderr: result.stderr,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Shared assertions: the child must join the parent's trace, hanging off the
 * span that spawned it.
 */
function assertJoinedTrace({ parentEvents, childEvents }) {
  const spawnSpan = parentEvents.find(
    (e) => e.event === 'enter' && e.method === 'callChild'
  );
  assert.ok(spawnSpan, 'expected an instrumented callChild span in the parent');

  const joined = childEvents.filter((e) => e.trace_id === spawnSpan.trace_id);
  assert.ok(
    joined.length > 0,
    'child emitted nothing in the parent trace — the env carrier did not propagate'
  );

  const childRoot = joined.find(
    (e) => e.event === 'enter' && e.parent_id === spawnSpan.span_id
  );
  assert.ok(
    childRoot,
    `no child span is parented to the spawning span ${spawnSpan.span_id}`
  );
  assert.equal(childRoot.depth, 0, 'the seeded child root must be depth 0');

  assert.ok(
    joined.some((e) => e.event === 'enter' && e.method === 'childWork'),
    'expected the child function to be traced inside the joined trace'
  );

  for (const e of [...parentEvents, ...childEvents]) {
    assert.ok(e.depth >= 0, `depth must be >= 0, got ${e.depth}`);
  }
}

test('subprocess: child joins parent trace (default import of child_process)', () => {
  assertJoinedTrace(runParent('spawn-parent-default.mjs'));
});

test('subprocess: child joins parent trace (NAMED import of child_process)', () => {
  // Regression guard for the ESM-facade snapshot problem described above.
  assertJoinedTrace(runParent('spawn-parent-named.mjs'));
});
