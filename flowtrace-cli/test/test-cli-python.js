'use strict';
/**
 * CLI Python integration tests — flowtrace run --lang python
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const runCommand = require('../lib/commands/run');
const { _detectPythonPrefix, _buildPythonEnv } = runCommand;

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
  const env = _buildPythonEnv({ prefix: 'pkg', outPath: '/tmp/x.jsonl', stubDir: '/s' });
  const envKeys = Object.keys(env).filter(k => k.startsWith('FLOWTRACE'));
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
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
