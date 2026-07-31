/**
 * FlowTrace must never instrument its own source.
 *
 * The only exclusion was '/node_modules/', which covers the installed-as-a-
 * dependency case but not running FROM SOURCE. With the default prefix
 * ("everything under cwd"), starting a traced program from a directory that
 * contains capture/node made the hook transform src/runtime/instrument.js itself,
 * and the traced program then died on a SyntaxError in our own `export` statement
 * before emitting a single event.
 *
 * That is not a hypothetical configuration: it is what happens when you run
 * anything from the repository root, and it is what made
 * benchmarks/truncation-parity.sh report node as failing while the actual cause
 * was self-instrumentation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');
const CAPTURE_NODE = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../../..');
const FIXTURE = join(REPO_ROOT, 'examples/golden/truncation/node/longArgFixture.js');

/**
 * Run a fixture with cwd set to the REPOSITORY ROOT, so FlowTrace's own source
 * falls inside the default prefix. That is the configuration that used to break.
 */
function runFromRepoRoot() {
  const outDir = join(
    tmpdir(),
    `ft-self-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');
  try {
    const result = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, FIXTURE], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '', // default: everything under cwd
        FLOWTRACE_MAX_ARG_LENGTH: '64',
        NODE_OPTIONS: '',
      },
      cwd: REPO_ROOT,
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

test('a traced program run from the repo root does not crash on our own source', () => {
  const { stdout, stderr, events } = runFromRepoRoot();

  // The exact failure: a SyntaxError raised while loading instrument.js, because
  // the hook had rewritten it.
  assert.ok(
    !/SyntaxError/.test(stderr ?? ''),
    `traced program hit a SyntaxError — FlowTrace instrumented itself:\n${stderr}`
  );
  assert.ok(
    !/instrument\.js/.test(stderr ?? ''),
    `FlowTrace's own runtime appeared in the traced program's errors:\n${stderr}`
  );

  // The program must still run and still be traced.
  assert.match(stdout ?? '', /result=processed:1000/, `program did not run:\n${stderr}`);
  assert.ok(events.length > 0, 'no events emitted');
});

test('no event describes a FlowTrace source file', () => {
  const { events } = runFromRepoRoot();

  // Belt and braces: even if self-instrumentation stopped crashing, tracing our
  // own internals would flood the user's trace with noise they cannot act on.
  const ownModules = new Set(['instrument', 'emitter', 'context', 'ids', 'propagation', 'swc']);
  for (const e of events) {
    assert.ok(
      !ownModules.has(e.module),
      `event for FlowTrace's own module "${e.module}" (${e.method}) leaked into the trace`
    );
  }
});

test('the self-guard covers the whole capture-node tree, not just the runtime', () => {
  // The guard is a prefix check on capture/node, so it must hold for the
  // transform and hooks too — those are what would rewrite themselves.
  const { events } = runFromRepoRoot();
  for (const e of events) {
    assert.ok(
      !String(e.module).startsWith(CAPTURE_NODE),
      `event module path is inside capture/node: ${e.module}`
    );
  }
});

test('truncation still works in that configuration', () => {
  // Regression guard for the reported symptom, not just the cause: this is the
  // case truncation-parity.sh was failing on.
  const { events } = runFromRepoRoot();
  const enter = events.find((e) => e.event === 'enter' && e.method === 'process');
  assert.ok(enter, 'the fixture function was not traced');
  assert.match(
    String(enter.args.data),
    /^<truncated:/,
    `expected a truncation marker, got: ${String(enter.args.data).slice(0, 60)}`
  );
});
