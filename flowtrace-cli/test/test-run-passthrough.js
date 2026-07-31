'use strict';
/**
 * `flowtrace run -- <cmd>` end to end.
 *
 * This is the tool's primary documented usage — it appears five times in the
 * run command's own help text — and it did not work at all, for any language.
 * The `run` command declared options but no positional argument, so commander
 * rejected the command line with "too many arguments for 'run'. Expected 0
 * arguments but got 2." before any FlowTrace code ran.
 *
 * Every other test in this directory exercises the helper functions
 * (buildNodeEnv, detectPythonPrefix, buildJavaInjection) directly, which is why
 * the suite was green while the CLI itself was unusable. These tests spawn the
 * real binary.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'flowtrace.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN_NODE = path.join(REPO_ROOT, 'examples', 'golden', 'node', 'calculator.js');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

/** Create a throwaway Node project containing the golden calculator. */
function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-pass-'));
  fs.copyFileSync(GOLDEN_NODE, path.join(dir, 'calculator.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
  return dir;
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

/** Events written under .flowtrace/ in a project directory. */
function emittedEvents(dir) {
  const outDir = path.join(dir, '.flowtrace');
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(outDir, f), 'utf8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
}

console.log('\nflowtrace run -- <cmd> passthrough\n');

test('run accepts a command after -- instead of rejecting it', () => {
  const dir = makeProject();
  try {
    const r = runCli(dir, ['run', '--', 'node', 'calculator.js']);
    // The exact regression: commander's arity check fired before anything else.
    assert.ok(
      !/too many arguments/i.test(r.stderr + r.stdout),
      `commander rejected the command line:\n${r.stderr}`
    );
    assert.ok(
      !/unknown command/i.test(r.stderr + r.stdout),
      `command not recognised:\n${r.stderr}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the traced program actually runs and its output is preserved', () => {
  const dir = makeProject();
  try {
    const r = runCli(dir, ['run', '--', 'node', 'calculator.js']);
    assert.ok(/^5$/m.test(r.stdout), `program output missing:\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a trace is emitted, so the run is not silently a no-op', () => {
  const dir = makeProject();
  try {
    runCli(dir, ['run', '--', 'node', 'calculator.js']);
    const events = emittedEvents(dir);
    assert.ok(events.length > 0, 'no events written under .flowtrace/');
    assert.ok(
      events.some((e) => e.method === 'run'),
      `expected the calculator call tree; got ${events.map((e) => e.method).join(', ')}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the captured event count is reported to the user', () => {
  // Because "ran fine, captured nothing" is this tool's dominant failure mode,
  // the count is part of the contract, not decoration.
  const dir = makeProject();
  try {
    const r = runCli(dir, ['run', '--', 'node', 'calculator.js']);
    assert.ok(
      /capturado\s*:\s*\d+\s*eventos/.test(r.stdout),
      `no capture summary in output:\n${r.stdout}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit --lang is honoured alongside the passthrough', () => {
  const dir = makeProject();
  try {
    const r = runCli(dir, ['run', '--lang', 'node', '--', 'node', 'calculator.js']);
    assert.ok(!/too many arguments/i.test(r.stderr), r.stderr);
    assert.ok(emittedEvents(dir).length > 0, 'no events with explicit --lang');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty trace is reported as a warning, not as success', () => {
  const dir = makeProject();
  try {
    const r = runCli(dir, [
      'run', '--lang', 'node', '--package-prefix', '/nonexistent-xyz',
      '--', 'node', 'calculator.js',
    ]);
    // The program still runs; the point is that FlowTrace says it captured nothing.
    assert.ok(/^5$/m.test(r.stdout), 'program should still run');
    assert.ok(
      /NO se capturó ningún evento/.test(r.stderr),
      `expected an empty-capture warning:\n${r.stderr}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run with no command reports the mistake instead of crashing', () => {
  const dir = makeProject();
  try {
    const r = runCli(dir, ['run']);
    assert.ok(r.status !== 0, 'expected a non-zero exit with no command');
    assert.ok(
      /comando/i.test(r.stderr + r.stdout),
      `expected a message about the missing command:\n${r.stderr}`
    );
    // The error path itself must work: chalk v5 is ESM-only, and resolving it
    // instead of the declared v4 turned every CLI error into
    // "TypeError: chalk.red is not a function".
    assert.ok(
      !/chalk\.\w+ is not a function/.test(r.stderr),
      `the error path itself is broken:\n${r.stderr}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
