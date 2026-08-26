/**
 * AC2 — `flowtrace init` and `flowtrace run` share one prefix-detection
 * implementation, not two.
 *
 * Real subprocess repro of the exact motivating case: pyproject.toml with
 * [project].name = "api-businessrules-over-validator" (hyphenated
 * distribution name) and the actual package at src/over_validator/__init__.py
 * (a different name, no explicit hatch/setuptools packages config to point
 * at it) — the case that was live-tested and found broken for `init` before
 * this fix (detect.js's _pythonPrefix() was still the old,
 * distribution-name-only implementation while run.js's detectPythonPrefix()
 * had already been fixed).
 *
 * Run: node test/test-init-python-prefix.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

function mkFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-init-prefix-'));
  fs.writeFileSync(
    path.join(cwd, 'pyproject.toml'),
    [
      '[project]',
      'name = "api-businessrules-over-validator"',
      'version = "0.1.0"',
      '',
    ].join('\n')
  );
  fs.mkdirSync(path.join(cwd, 'src', 'over_validator'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'over_validator', '__init__.py'), '');
  return cwd;
}

async function main() {
  const bin = path.resolve(__dirname, '..', 'bin', 'flowtrace.js');

  console.log('\n[AC2 live repro: flowtrace init detects import name, not distribution name]');

  const cwd = mkFixture();
  let out = '';
  try {
    out = execFileSync(process.execPath, [bin, 'init'], { cwd, timeout: 10000 }).toString();
  } catch (e) {
    out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    assert(false, `flowtrace init exited non-zero: ${out}`);
  }

  const cfgPath = path.join(cwd, '.flowtrace', 'config.json');
  assert(fs.existsSync(cfgPath), 'init wrote .flowtrace/config.json');

  if (fs.existsSync(cfgPath)) {
    const config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert(config.lang === 'python', `detected lang is python (got ${config.lang})`);
    assert(
      config.capture && config.capture.packagePrefix === 'over_validator',
      `packagePrefix is 'over_validator', the real import name — NOT 'api_businessrules_over_validator' (the distribution-name fallback the old, separate detect.js implementation would have produced). Got: ${config.capture && config.capture.packagePrefix}`
    );
  }
  assert(/over_validator/.test(out), `init's own stdout reports the correct prefix (got: ${out.trim()})`);

  fs.rmSync(cwd, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
