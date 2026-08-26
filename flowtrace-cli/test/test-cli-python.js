'use strict';
/**
 * CLI Python integration tests — flowtrace run --lang python
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const runCommand = require('../lib/commands/run');
const { _detectPythonPrefix, _buildPythonEnv, _countJsonlLines } = runCommand;

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
// 1. buildPythonEnv composes PYTHONPATH correctly
// ---------------------------------------------------------------------------
test('buildPythonEnv sets FLOWTRACE_* env vars', () => {
  const env = _buildPythonEnv({
    prefix: 'mypkg',
    outPath: '/tmp/trace.jsonl',
    stubDir: '/stub',
  });
  assert.strictEqual(env.FLOWTRACE_ENABLE, '1');
  assert.strictEqual(env.FLOWTRACE_PACKAGE_PREFIX, 'mypkg');
  assert.strictEqual(env.FLOWTRACE_OUTPUT, '/tmp/trace.jsonl');
});

test('buildPythonEnv prepends stubDir to PYTHONPATH', () => {
  const original = process.env.PYTHONPATH;
  delete process.env.PYTHONPATH;
  const env = _buildPythonEnv({ prefix: 'pkg', outPath: '/tmp/x.jsonl', stubDir: '/mystub' });
  assert.ok(env.PYTHONPATH.startsWith('/mystub'), `PYTHONPATH=${env.PYTHONPATH}`);
  if (original !== undefined) process.env.PYTHONPATH = original;
});

test('buildPythonEnv preserves existing PYTHONPATH', () => {
  const original = process.env.PYTHONPATH;
  process.env.PYTHONPATH = '/existing';
  const env = _buildPythonEnv({ prefix: 'pkg', outPath: '/tmp/x.jsonl', stubDir: '/mystub' });
  assert.ok(env.PYTHONPATH.includes('/existing'), `PYTHONPATH=${env.PYTHONPATH}`);
  assert.ok(env.PYTHONPATH.startsWith('/mystub'), `PYTHONPATH=${env.PYTHONPATH}`);
  if (original !== undefined) process.env.PYTHONPATH = original;
  else delete process.env.PYTHONPATH;
});

// ---------------------------------------------------------------------------
// 2. detectPythonPrefix reads pyproject.toml
// ---------------------------------------------------------------------------
test('detectPythonPrefix reads pyproject.toml [project] name', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "my-app"
version = "1.0.0"
`);
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'my_app');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix reads setup.py name', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'setup.py'), `
setup(
    name='cool-service',
    version='0.1',
)
`);
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'cool_service');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix returns null when no config found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, null);
  fs.rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// 3. subprocess argv is passed unchanged (no splicing)
// ---------------------------------------------------------------------------
test('buildPythonEnv does not alter user command args', () => {
  // Verify that env composition doesn't touch argv — the caller passes restArgs
  // directly to spawn(). We verify env keys only relate to flowtrace, not argv.
  // Snapshot ambient FLOWTRACE_* keys first so a stray var already present in
  // the runner's shell (e.g. FLOWTRACE_AGENT) doesn't break this assertion —
  // we only assert on the keys _buildPythonEnv itself adds.
  const ambientKeys = Object.keys(process.env).filter(k => k.startsWith('FLOWTRACE'));
  const env = _buildPythonEnv({ prefix: 'pkg', outPath: '/tmp/x.jsonl', stubDir: '/s' });
  const envKeys = Object.keys(env).filter(k => k.startsWith('FLOWTRACE') && !ambientKeys.includes(k));
  assert.deepStrictEqual(envKeys.sort(), ['FLOWTRACE_ENABLE', 'FLOWTRACE_OUTPUT', 'FLOWTRACE_PACKAGE_PREFIX'].sort());
});

// ---------------------------------------------------------------------------
// 4. H1 — both stubDir AND capture/python/ (runtimeParent) are on PYTHONPATH
// ---------------------------------------------------------------------------
test('buildPythonEnv includes runtimeParent (capture/python/) on PYTHONPATH', () => {
  const original = process.env.PYTHONPATH;
  delete process.env.PYTHONPATH;
  const env = _buildPythonEnv({ prefix: 'pkg', outPath: '/tmp/x.jsonl', stubDir: '/mystub' });
  const parts = env.PYTHONPATH.split(path.delimiter);
  // stubDir must be present
  assert.ok(parts.includes('/mystub'), `stubDir missing from PYTHONPATH: ${env.PYTHONPATH}`);
  // capture/python/ (runtimeParent) must also be present
  const hasRuntimeParent = parts.some(p => p.endsWith(path.join('capture', 'python')));
  assert.ok(hasRuntimeParent, `runtimeParent (capture/python/) missing from PYTHONPATH: ${env.PYTHONPATH}`);
  if (original !== undefined) process.env.PYTHONPATH = original;
});

// ---------------------------------------------------------------------------
// AC4 — detectPythonPrefix finds the *import* name, not the distribution name
// ---------------------------------------------------------------------------

test('detectPythonPrefix: hatch build-targets.wheel packages entry wins over [project].name', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "api-businessrules-over-validator"

[tool.hatch.build.targets.wheel]
packages = ["src/over_validator"]
`);
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'over_validator');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix: setuptools packages.find include entry wins over [project].name', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "pyyaml"

[tool.setuptools.packages.find]
include = ["yaml*"]
`);
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'yaml');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix: single package under src/ wins over dist-name guess', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "beautifulsoup4"
`);
  fs.mkdirSync(path.join(tmpDir, 'src', 'bs4'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'bs4', '__init__.py'), '');
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'bs4');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix: single package next to pyproject.toml wins over dist-name guess', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "api-businessrules-over-validator"
`);
  fs.mkdirSync(path.join(tmpDir, 'over_validator'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'over_validator', '__init__.py'), '');
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'over_validator');
  fs.rmSync(tmpDir, { recursive: true });
});

test('detectPythonPrefix: still falls back to dist-name guess when nothing else matches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "my-app"
`);
  const prefix = _detectPythonPrefix(tmpDir);
  assert.strictEqual(prefix, 'my_app');
  fs.rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// AC4 — a wrong prefix must never be silent: zero-event Python runs warn
// ---------------------------------------------------------------------------

test('flowtrace run --lang python warns on stderr and reports 0 events for a wrong prefix', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
  try {
    // A real project the auto-detector *would* resolve correctly via the
    // src/ layout check — but we force a deliberately wrong prefix via the
    // CLI flag to reproduce "prefix does not match the importable package".
    fs.mkdirSync(path.join(tmpDir, 'src', 'realpkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'realpkg', '__init__.py'), '');
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), `
[project]
name = "real-pkg"
`);
    const result = spawnSync(process.execPath, [
      BIN, 'run', '--lang', 'python', '--package-prefix', 'totally_wrong_name',
      '--', 'python3', '-c', 'pass',
    ], { cwd: tmpDir, encoding: 'utf-8' });

    assert.strictEqual(result.status, 0, `expected exit 0 (silent-success shape), got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /0 eventos capturados/i, 'must warn loudly about zero captured events');
    assert.match(result.stdout + result.stderr, /totally_wrong_name/, 'output names the prefix that was used, somewhere');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// _countJsonlLines — must stream, never fs.readFileSync() the whole file
// (readFileSync on a large trace crashes with ERR_STRING_TOO_LONG; see the
// run.js zero-event-check fix). Async, so run after the sync tests above.
// ---------------------------------------------------------------------------

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

async function runAsyncTests() {
  await testAsync('_countJsonlLines counts non-empty lines correctly on an ordinary file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
    try {
      const p = path.join(tmpDir, 'trace.jsonl');
      fs.writeFileSync(p, '{"a":1}\n{"a":2}\n\n{"a":3}\n');
      const n = await _countJsonlLines(p);
      assert.strictEqual(n, 3, 'blank lines must not be counted');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await testAsync('_countJsonlLines resolves 0 for a missing file, does not throw', async () => {
    const n = await _countJsonlLines('/nonexistent/path/does-not-exist.jsonl');
    assert.strictEqual(n, 0);
  });

  await testAsync('_countJsonlLines never calls fs.readFileSync (streams instead)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
    try {
      const p = path.join(tmpDir, 'trace.jsonl');
      fs.writeFileSync(p, '{"a":1}\n{"a":2}\n');
      const original = fs.readFileSync;
      let called = false;
      fs.readFileSync = (...args) => { called = true; return original(...args); };
      try {
        await _countJsonlLines(p);
      } finally {
        fs.readFileSync = original;
      }
      assert.strictEqual(called, false, '_countJsonlLines must not read the whole file into a string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Real repro: a file whose size exceeds Node's MAX_STRING_LENGTH makes
  // fs.readFileSync(path, 'utf-8') throw ERR_STRING_TOO_LONG (verified
  // manually against the actual limit — see QA notes). _countJsonlLines must
  // resolve normally on the same file. Skipped by default: writing 560MB+ is
  // too slow/disk-heavy for a routine test run; opt in with
  // FLOWTRACE_TEST_LARGE_FILE=1.
  if (process.env.FLOWTRACE_TEST_LARGE_FILE === '1') {
    await testAsync('_countJsonlLines handles a file too large for fs.readFileSync', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cli-test-'));
      try {
        const p = path.join(tmpDir, 'big.jsonl');
        const line = JSON.stringify({ event: 'exit', method: 'foo', duration_ns: 123 }) + '\n';
        const chunk = line.repeat(50000);
        const target = require('buffer').constants.MAX_STRING_LENGTH + 10 * 1024 * 1024;
        const fd = fs.openSync(p, 'w');
        let written = 0;
        while (written < target) {
          fs.writeSync(fd, chunk);
          written += Buffer.byteLength(chunk);
        }
        fs.closeSync(fd);

        assert.throws(() => fs.readFileSync(p, 'utf-8'), /ERR_STRING_TOO_LONG/,
          'test setup invalid: file must actually exceed MAX_STRING_LENGTH');

        const n = await _countJsonlLines(p);
        assert.ok(n > 0, 'must return a real count instead of crashing');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
runAsyncTests().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
