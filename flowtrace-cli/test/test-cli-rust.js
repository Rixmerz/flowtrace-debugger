'use strict';
/**
 * CLI Rust integration tests — flowtrace run --lang rust
 *
 * The pure pieces (_buildRustInvocation, _parseCargoCommand), the up-front
 * validation of the user's command, and one real run through the flowtrace-rust
 * driver. That last test needs `cargo`, like the Go one needs `go`.
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const runCommand = require('../lib/commands/run');
const { _buildRustInvocation, _parseCargoCommand, _detectRustPackageName } = runCommand;

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

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-rust-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const base = {
  driver: '/repo/capture/rust/target/release/flowtrace-rust',
  captureDir: '/repo/capture/rust',
  moduleDir: '/home/user/app',
  prefix: 'kerno',
  cargoArgs: ['cargo', 'run', '--release'],
  outPath: '/home/user/app/.flowtrace/out.jsonl',
};

// ---- _parseCargoCommand ----------------------------------------------------

test('_parseCargoCommand accepts cargo run, build and test', () => {
  for (const sub of ['run', 'build', 'test']) {
    assert.strictEqual(_parseCargoCommand(['cargo', sub]), sub);
  }
});

test('_parseCargoCommand looks past a +toolchain', () => {
  assert.strictEqual(_parseCargoCommand(['cargo', '+nightly', 'test', '-p', 'x']), 'test');
});

test('_parseCargoCommand refuses anything that is not cargo run|build|test', () => {
  assert.strictEqual(_parseCargoCommand(['./target/release/app']), null, 'a built binary');
  assert.strictEqual(_parseCargoCommand(['cargo', 'check']), null, 'check produces nothing to run');
  assert.strictEqual(_parseCargoCommand(['cargo']), null);
  assert.strictEqual(_parseCargoCommand([]), null);
});

// ---- _buildRustInvocation --------------------------------------------------

test('_buildRustInvocation runs the driver binary directly with --dir, --capture-dir, the prefix, then the cargo command', () => {
  const { cmd, args } = _buildRustInvocation(base);
  assert.strictEqual(cmd, base.driver);
  assert.deepStrictEqual(args, [
    '--dir', '/home/user/app', '--capture-dir', '/repo/capture/rust',
    '--package-prefix', 'kerno',
    'cargo', 'run', '--release',
  ]);
});

test('_buildRustInvocation leaves the prefix to the driver when there is none', () => {
  const { args } = _buildRustInvocation({ ...base, prefix: null });
  assert.ok(!args.includes('--package-prefix'), 'a workspace root has no package name: the driver derives the prefix');
});

test('_buildRustInvocation sets FLOWTRACE_OUTPUT and keeps the rest of process.env', () => {
  process.env.FLOWTRACE_RUST_TEST_MARKER = 'still-here';
  try {
    const { env } = _buildRustInvocation(base);
    assert.strictEqual(env.FLOWTRACE_OUTPUT, base.outPath);
    assert.strictEqual(env.FLOWTRACE_RUST_TEST_MARKER, 'still-here');
  } finally {
    delete process.env.FLOWTRACE_RUST_TEST_MARKER;
  }
});

test('run.js and rust-package.js expose one detectRustPackageName', () => {
  assert.strictEqual(_detectRustPackageName, require('../lib/rust-package').detectRustPackageName);
});

// ---- validation, as a subprocess -------------------------------------------

function mkCrate(dir) {
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "ftclitest"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'main.rs'), [
    'fn main() {',
    '    println!("{}", add(2, 3));',
    '}',
    '',
    'fn add(a: i32, b: i32) -> i32 {',
    '    a + b',
    '}',
    '',
  ].join('\n'));
}

test('flowtrace run --lang rust rejects a command that is not cargo run|build|test', () => {
  withTmp((dir) => {
    mkCrate(dir);
    const r = spawnSync(process.execPath, [BIN, 'run', '--lang', 'rust', '--', './target/release/app'], { cwd: dir, encoding: 'utf-8' });
    assert.notStrictEqual(r.status, 0, 'a prebuilt binary must be refused, not silently traced empty');
    assert.match(r.stderr, /cargo run.*cargo build.*cargo test/, `expected an actionable error, got: ${r.stderr}`);
  });
});

test('flowtrace run --lang rust requires a command after --', () => {
  withTmp((dir) => {
    mkCrate(dir);
    const r = spawnSync(process.execPath, [BIN, 'run', '--lang', 'rust'], { cwd: dir, encoding: 'utf-8' });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Provide the command/);
  });
});

test('flowtrace run auto-detects Rust from Cargo.toml', () => {
  withTmp((dir) => {
    mkCrate(dir);
    const r = spawnSync(process.execPath, [BIN, 'run', '--', './target/release/app'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /lang \(detectado\): rust/, `got: ${r.stdout}${r.stderr}`);
  });
});

// ---- a real run ------------------------------------------------------------

test('flowtrace run --lang rust -- cargo run traces the crate and writes valid v2 JSONL', () => {
  if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('cargo is required for this test');
  }
  withTmp((dir) => {
    mkCrate(dir);
    const out = path.join(dir, 'trace.jsonl');
    const r = spawnSync(process.execPath, [BIN, 'run', '--lang', 'rust', '--out', out, '--', 'cargo', 'run', '--quiet'], {
      cwd: dir, encoding: 'utf-8', timeout: 240000,
    });
    assert.strictEqual(r.status, 0, `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /^5$/m, "the program's own stdout (add(2,3)=5) must still print");

    const events = fs.readFileSync(out, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const enter = (m) => events.find((e) => e.method === m && e.event === 'enter');
    const exit = (m) => events.find((e) => e.method === m && e.event === 'exit');
    assert.strictEqual(enter('add').parent_id, enter('main').span_id, 'add is a child span of main');
    assert.deepStrictEqual(enter('add').args, { a: 2, b: 3 });
    assert.deepStrictEqual(exit('add').result, { r0: 5 });
    assert.strictEqual(enter('main').lang, 'rust');
    assert.strictEqual(enter('main').module, 'ftclitest');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
