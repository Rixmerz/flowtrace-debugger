'use strict';
/**
 * CLI Go integration tests — flowtrace run --lang go
 *
 * Covers the pieces exported specifically so they could be tested
 * (_buildGoInvocation, _detectGoModulePath) plus real subprocess repros of
 * runGo's validation and its happy path, following the pattern in
 * test-cli-python.js / test-init-python-prefix.js.
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const runCommand = require('../lib/commands/run');
const { _buildGoInvocation, _detectGoModulePath } = runCommand;
const { detectGoModulePath } = require('../lib/go-module');

const BIN = path.resolve(__dirname, '../bin/flowtrace.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// _buildGoInvocation — pure function, composes the `go run <driver>` argv
// ---------------------------------------------------------------------------

test('_buildGoInvocation runs from captureGoDir, not the target module dir', () => {
  const { cmd, cwd } = _buildGoInvocation({
    captureGoDir: '/repo/capture/go',
    moduleDir: '/home/user/myapp',
    goSubcommand: 'run',
    goRest: ['.'],
    outPath: '/home/user/myapp/.flowtrace/out.jsonl',
  });
  assert.strictEqual(cmd, 'go');
  assert.strictEqual(cwd, '/repo/capture/go', 'go run must resolve flowtrace-go\'s own module, so cwd is captureGoDir');
});

test('_buildGoInvocation passes the driver dir, -runtime-src and -dir <moduleDir> before the user subcommand', () => {
  const { args } = _buildGoInvocation({
    captureGoDir: '/repo/capture/go',
    moduleDir: '/home/user/myapp',
    goSubcommand: 'run',
    goRest: ['./cmd/api'],
    outPath: '/out.jsonl',
  });
  assert.deepStrictEqual(args, [
    'run', path.join('/repo/capture/go', 'cmd', 'flowtrace-go'),
    '-runtime-src', path.join('/repo/capture/go', 'flowtracert'),
    '-dir', '/home/user/myapp',
    'run', './cmd/api',
  ]);
});

test('_buildGoInvocation forwards build subcommand and its own args unchanged', () => {
  const { args } = _buildGoInvocation({
    captureGoDir: '/repo/capture/go',
    moduleDir: '/home/user/myapp',
    goSubcommand: 'build',
    goRest: ['-o', 'bin/app', './cmd/api'],
    outPath: '/out.jsonl',
  });
  assert.deepStrictEqual(args.slice(-4), ['build', '-o', 'bin/app', './cmd/api']);
});

test('_buildGoInvocation sets FLOWTRACE_OUTPUT on env without discarding the rest of process.env', () => {
  const original = process.env.FLOWTRACE_GO_TEST_MARKER;
  process.env.FLOWTRACE_GO_TEST_MARKER = 'still-here';
  const { env } = _buildGoInvocation({
    captureGoDir: '/repo/capture/go',
    moduleDir: '/home/user/myapp',
    goSubcommand: 'run',
    goRest: ['.'],
    outPath: '/tmp/x.jsonl',
  });
  assert.strictEqual(env.FLOWTRACE_OUTPUT, '/tmp/x.jsonl');
  assert.strictEqual(env.FLOWTRACE_GO_TEST_MARKER, 'still-here', 'env must inherit process.env, not replace it');
  if (original !== undefined) process.env.FLOWTRACE_GO_TEST_MARKER = original;
  else delete process.env.FLOWTRACE_GO_TEST_MARKER;
});

// ---------------------------------------------------------------------------
// _detectGoModulePath — run.js and lib/detect.js (via lib/go-module.js) must
// share ONE implementation, the same story go-module.js's own header comment
// tells about lib/python-prefix.js: two independent readers of the same file
// drift the moment only one gets fixed.
// ---------------------------------------------------------------------------

test('run.js and go-module.js expose the exact same detectGoModulePath function (one implementation)', () => {
  assert.strictEqual(_detectGoModulePath, detectGoModulePath, 'must be the identical function reference, not a second implementation');
});

test('_detectGoModulePath reads the module line of go.mod', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-go-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module github.com/acme/widget\n\ngo 1.24\n');
    assert.strictEqual(_detectGoModulePath(tmpDir), 'github.com/acme/widget');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('_detectGoModulePath returns null when go.mod is absent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-go-test-'));
  try {
    assert.strictEqual(_detectGoModulePath(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runGo — real subprocess repros
// ---------------------------------------------------------------------------

function mkGoFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-go-fixture-'));
  fs.writeFileSync(path.join(cwd, 'go.mod'), 'module example.com/ftclitest\n\ngo 1.24\n');
  fs.writeFileSync(path.join(cwd, 'main.go'), [
    'package main',
    '',
    'import "fmt"',
    '',
    'func Add(a, b int) int {',
    '\treturn a + b',
    '}',
    '',
    'func main() {',
    '\tfmt.Println(Add(2, 3))',
    '}',
    '',
  ].join('\n'));
  return cwd;
}

test('flowtrace run --lang go rejects a command that is not `go run|build|test`', () => {
  const tmpDir = mkGoFixture();
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lang', 'go', '--', './myapp',
    ], { cwd: tmpDir, encoding: 'utf-8' });
    assert.notStrictEqual(result.status, 0, 'a prebuilt binary must be rejected, not silently traced empty');
    assert.match(result.stderr, /go run.*go build.*go test|instrumenta/i, `expected an actionable error, got: ${result.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('flowtrace run --lang go rejects `go vet` (not in GO_SUBCOMMANDS)', () => {
  const tmpDir = mkGoFixture();
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lang', 'go', '--', 'go', 'vet', './...',
    ], { cwd: tmpDir, encoding: 'utf-8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /go run.*go build.*go test|instrumenta/i, `expected an actionable error, got: ${result.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('flowtrace run --lang go requires a command after --', () => {
  const tmpDir = mkGoFixture();
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lang', 'go',
    ], { cwd: tmpDir, encoding: 'utf-8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /comando a ejecutar/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('flowtrace run --lang go -- go run . traces the module and writes valid v2 JSONL', () => {
  const tmpDir = mkGoFixture();
  try {
    const outPath = path.join(tmpDir, 'trace.jsonl');
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lang', 'go', '--out', outPath, '--', 'go', 'run', '.',
    ], { cwd: tmpDir, encoding: 'utf-8', timeout: 60000 });

    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /^5$/m, `traced program's own stdout (Add(2,3)=5) must still print — got: ${result.stdout}`);
    assert.match(result.stdout + result.stderr, /example\.com\/ftclitest/, 'module path detected and reported');

    assert.ok(fs.existsSync(outPath), `${outPath} must exist`);
    const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 4, `expected at least 4 events (main+Add enter/exit), got ${lines.length}`);

    const events = lines.map((l) => JSON.parse(l));
    const enterMain = events.find((e) => e.event === 'enter' && e.method === 'main');
    const enterAdd = events.find((e) => e.event === 'enter' && e.method === 'Add');
    const exitAdd = events.find((e) => e.event === 'exit' && e.method === 'Add');

    assert.ok(enterMain, 'main() enter event present');
    assert.ok(enterAdd, 'Add() enter event present');
    assert.ok(exitAdd, 'Add() exit event present');
    assert.strictEqual(enterAdd.parent_id, enterMain.span_id, 'Add is a child span of main');
    assert.strictEqual(exitAdd.result.r0, 5, 'Add(2,3) result captured as 5');
    assert.strictEqual(enterMain.lang, 'go');
    assert.match(enterMain.thread, /^goroutine-\d+$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
