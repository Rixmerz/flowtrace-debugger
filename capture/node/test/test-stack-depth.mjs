/**
 * Stack-depth behaviour of the capture layer.
 *
 * The bug these cover: a Node ESM server that ran fine on its own died on
 * startup under `flowtrace run` with an uncaught
 *
 *     RangeError: Maximum call stack size exceeded
 *         at ... node:internal/crypto/random
 *
 * and nothing of the user's program on the stack. newSpanId() called
 * crypto.randomBytes, randomBytes allocates an async resource, and with
 * AsyncLocalStorage active that ran an async_hooks init hook — which, when it
 * runs out of stack, Node answers with fatalError(): uncatchable, so no
 * try/catch in this runtime could contain it.
 *
 * Instrumented code has roughly 5-8x less usable stack depth than the same
 * code untraced, and that is inherent to rewriting every function body into a
 * nested arrow. So the contract is NOT "deep recursion always survives". It is:
 * minting ids never touches async_hooks, the helpers never turn a working
 * program's error into FlowTrace's own, and what was lost is reported.
 *
 * Runs with: node --test test/test-stack-depth.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');

/** Runs `source` as an instrumented ESM program in a throwaway project. */
function runTraced(source, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-stack-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stack-fixture', type: 'module' }));
    const script = join(dir, 'src', 'main.js');
    writeFileSync(script, source);
    return spawnSync(process.execPath, ['--import', pathToFileURL(BOOTSTRAP).href, script], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: join(dir, 'trace.jsonl'),
        FLOWTRACE_PACKAGE_PREFIX: dir,
        NODE_OPTIONS: '',
        ...env,
      },
      cwd: dir,
      timeout: 60000,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Recursion far past any stack, with the program catching its own overflow.
 * Untraced this prints a depth and exits 0; the regression was that under
 * instrumentation it did not get the chance, because the RangeError arrived
 * through async_hooks as a fatal error the program could not catch.
 */
const SELF_CATCHING = `
let reached = 0;
function down(n) { reached = n; return down(n + 1); }
try { down(0); } catch (e) { console.log('CAUGHT', e.constructor.name, reached > 0); }
console.log('STILL RUNNING');
`;

test('a program that catches its own stack overflow still runs under instrumentation', () => {
  const r = runTraced(SELF_CATCHING);
  assert.equal(r.status, 0, `expected a clean exit, got ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /CAUGHT RangeError true/);
  assert.match(r.stdout, /STILL RUNNING/, 'the program must keep running past its own overflow');
});

test('stack exhaustion never surfaces from crypto or as a fatal async_hooks error', () => {
  const r = runTraced(SELF_CATCHING);
  assert.doesNotMatch(r.stderr, /internal\/crypto\/random/, 'ids must not go through async_hooks');
  assert.doesNotMatch(r.stderr, /fatalError/, 'a fatal async_hooks error cannot be caught by anyone');
});

test('calls past FLOWTRACE_MAX_DEPTH are skipped and counted, not traced', () => {
  // Bounded recursion, nowhere near the stack limit: the only reason to skip a
  // call here is the depth limit, so the two diagnostics cannot be confused.
  const BOUNDED = `
function down(n) { return n === 0 ? 0 : down(n - 1) + 1; }
console.log('DONE', down(40));
`;
  const r = runTraced(BOUNDED, { FLOWTRACE_MAX_DEPTH: '8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DONE 40/);
  assert.match(
    r.stderr,
    // down(40) is 41 calls at depths 0..40; the 33 at depth >= 8 are skipped.
    /\[flowtrace\] 33 call\(s\) nested deeper than FLOWTRACE_MAX_DEPTH \(8\)/,
    'the depth limit must say how much of the trace is missing'
  );
  assert.doesNotMatch(r.stderr, /ran untraced/, 'nothing failed here — only the limit applied');
});

test('the depth limit buys real stack back', () => {
  const PROBE = `
let reached = 0;
function down(n) { reached = n; return down(n + 1); }
try { down(0); } catch { console.log('DEPTH', reached); }
`;
  const depthOf = (env) => {
    const r = runTraced(PROBE, env);
    assert.equal(r.status, 0, r.stderr);
    return Number(r.stdout.match(/DEPTH (\d+)/)[1]);
  };
  // 0 disables the limit, which is the pre-fix behaviour: every level pays for
  // a span. A shallow limit stops paying and the program reaches further down.
  assert.ok(
    depthOf({ FLOWTRACE_MAX_DEPTH: '32' }) > depthOf({ FLOWTRACE_MAX_DEPTH: '0' }),
    'capping the traced depth must let the program recurse deeper than tracing every level'
  );
});

test('an exit helper that cannot serialize does not replace the program\'s own error', async () => {
  const { __ft_enter, __ft_exit_error } = await import('../src/runtime/instrument.js?stack-depth');
  const ctx = __ft_enter('m', null, 'f', 'public', [], [], 'node');
  // An error whose own fields throw: errorInfo() reads .name/.message/.stack.
  const hostile = { get name() { throw new Error('boom'); } };
  assert.doesNotThrow(
    () => __ft_exit_error(ctx, 'm', null, 'f', 'public', [], [], hostile, 'node'),
    'the transform rethrows the program\'s error right after this call'
  );
});
