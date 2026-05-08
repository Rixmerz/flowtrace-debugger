'use strict';
/**
 * CLI Node/TS integration tests — flowtrace run --lang node|ts
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const runCommand = require('../lib/commands/run');
const { _buildNodeEnv } = runCommand;

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

// Repo root: flowtrace-cli/../
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXPECTED_BOOTSTRAP = path.join(REPO_ROOT, 'capture', 'node', 'src', 'bootstrap.mjs');

// ---------------------------------------------------------------------------
// 1. buildNodeEnv composes NODE_OPTIONS with --import and bootstrap path

test('buildNodeEnv includes --import flag in NODE_OPTIONS', () => {
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix: '/some/project',
    outPath: '/tmp/trace.jsonl',
  });
  assert.ok(
    env.NODE_OPTIONS.includes('--import'),
    `NODE_OPTIONS should contain --import, got: ${env.NODE_OPTIONS}`
  );
});

// ---------------------------------------------------------------------------
// 2. Bootstrap path is absolute

test('bootstrap path used in NODE_OPTIONS is absolute (file:// scheme)', () => {
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix: '/some/project',
    outPath: '/tmp/trace.jsonl',
  });
  assert.ok(
    env.NODE_OPTIONS.includes(`file://${EXPECTED_BOOTSTRAP}`),
    `NODE_OPTIONS should reference bootstrap as file://<abs>, got: ${env.NODE_OPTIONS}`
  );
});

// ---------------------------------------------------------------------------
// 3. FLOWTRACE_OUTPUT and FLOWTRACE_PACKAGE_PREFIX are set

test('buildNodeEnv sets FLOWTRACE_OUTPUT correctly', () => {
  const outPath = '/tmp/ft-test/trace.jsonl';
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix: 'myapp',
    outPath,
  });
  assert.strictEqual(env.FLOWTRACE_OUTPUT, outPath);
});

test('buildNodeEnv sets FLOWTRACE_PACKAGE_PREFIX correctly', () => {
  const prefix = 'com.example';
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix,
    outPath: '/tmp/trace.jsonl',
  });
  assert.strictEqual(env.FLOWTRACE_PACKAGE_PREFIX, prefix);
});

// ---------------------------------------------------------------------------
// 4. --package-prefix custom overrides default cwd

test('--package-prefix custom value ends up in FLOWTRACE_PACKAGE_PREFIX', () => {
  const customPrefix = 'my-custom-prefix';
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix: customPrefix,
    outPath: '/tmp/trace.jsonl',
  });
  assert.strictEqual(env.FLOWTRACE_PACKAGE_PREFIX, customPrefix);
});

// ---------------------------------------------------------------------------
// 5. ts lang routes same as node lang (buildNodeEnv is shared)

test('ts lang: NODE_OPTIONS still contains --import (same helper as node)', () => {
  // Both node and ts use buildNodeEnv — verify the function itself works
  // independently of which lang string triggered it.
  const env = _buildNodeEnv({
    bootstrapPath: EXPECTED_BOOTSTRAP,
    prefix: '/ts/project',
    outPath: '/tmp/ts-trace.jsonl',
  });
  assert.ok(env.NODE_OPTIONS.includes('--import'));
  assert.ok(env.NODE_OPTIONS.includes('--enable-source-maps'));
});

// ---------------------------------------------------------------------------
// 6. bootstrap.mjs actually exists at expected path

test('bootstrap.mjs exists at expected repo path', () => {
  assert.ok(
    fs.existsSync(EXPECTED_BOOTSTRAP),
    `Expected bootstrap at: ${EXPECTED_BOOTSTRAP}`
  );
});

// ---------------------------------------------------------------------------
// 7. Existing NODE_OPTIONS are preserved (not overwritten)

test('buildNodeEnv preserves existing NODE_OPTIONS', () => {
  const original = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--max-old-space-size=512';
  try {
    const env = _buildNodeEnv({
      bootstrapPath: EXPECTED_BOOTSTRAP,
      prefix: 'test',
      outPath: '/tmp/trace.jsonl',
    });
    assert.ok(
      env.NODE_OPTIONS.includes('--max-old-space-size=512'),
      `Existing NODE_OPTIONS should be preserved, got: ${env.NODE_OPTIONS}`
    );
  } finally {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  }
});

// ---------------------------------------------------------------------------

console.log('\nCLI Node/TS tests\n');
// Results already printed per test above
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
