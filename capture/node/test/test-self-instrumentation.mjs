/**
 * FlowTrace must never instrument its own runtime.
 *
 * The only exclusion was '/node_modules/', which covers being installed as a
 * dependency but not running from source. With the default prefix — everything
 * under cwd — launching a traced program from a directory containing
 * capture/node made the loader rewrite FlowTrace's own modules, and the program
 * then died inside our code.
 *
 * The reason this needs a test rather than a code comment is how it failed:
 * exit status 0, empty stdout, empty stderr, no events. Nothing anywhere said
 * the program had not run. A user would conclude their app produced no trace,
 * not that the tracer had killed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const BOOTSTRAP = join(PKG, 'src', 'bootstrap.mjs');

/** Runs `body` as a module inside the package, with cwd there too. */
function runInsidePackage(body, env = {}) {
  const file = join(HERE, 'fixtures', `self-instr-probe-${process.pid}.mjs`);
  writeFileSync(file, body);
  try {
    return spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, file], {
      cwd: PKG,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, NODE_OPTIONS: '', ...env },
    });
  } finally {
    rmSync(file, { force: true });
  }
}

test('a program launched from inside the package still runs', () => {
  const res = runInsidePackage('console.log("ran");\n');
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.equal(res.stdout.trim(), 'ran',
    'the program produced no output — FlowTrace instrumented itself and killed it');
});

test('instrumentation still applies to the traced program itself', () => {
  // The exclusion must be scoped to src/, not the whole package: over-excluding
  // would make every fixture-based test silently stop producing events, which
  // looks exactly like the bug it was meant to fix.
  const res = runInsidePackage(
    'function traced(){ return 42; }\ntraced();\nconsole.log("done");\n'
  );
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.equal(res.stdout.trim(), 'done');
});
