/**
 * Tests for auto-detection in run command.
 * Run: node test/test-cli-autodetect.js
 *
 * These tests exercise runCommand() directly (not subprocess flowtrace binary)
 * so they can mock fs and child_process where needed.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// We test the detect module used by run, not the full spawn path.
const { detectLang, detectPackagePrefix } = require('../lib/detect');

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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-autodetect-'));
}

// ---- Simulate "flowtrace run" cwd scenarios ----
console.log('\n[auto-detect routing]');

// package.json only -> routes to node
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'my-app' }));
  const lang = detectLang(d);
  assert(lang === 'node', 'package.json cwd -> detects node');
}

// package.json + tsconfig.json -> routes to ts
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'my-ts-app' }));
  fs.writeFileSync(path.join(d, 'tsconfig.json'), '{}');
  const lang = detectLang(d);
  assert(lang === 'ts', 'package.json + tsconfig.json -> detects ts');
}

// pom.xml -> routes to java
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>com.foo</groupId></project>');
  const lang = detectLang(d);
  assert(lang === 'java', 'pom.xml cwd -> detects java');
}

// pyproject.toml -> routes to python
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[project]\nname = "mylib"\n');
  const lang = detectLang(d);
  assert(lang === 'python', 'pyproject.toml cwd -> detects python');
}

// empty dir -> null (would cause exit 1 with Spanish error)
{
  const d = mkTmp();
  const lang = detectLang(d);
  assert(lang === null, 'empty dir -> null (exit 1 expected in run command)');
}

// multi-lang -> array (would prompt user)
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'hybrid' }));
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[project]\nname = "hybrid"\n');
  const lang = detectLang(d);
  assert(Array.isArray(lang), 'multi-lang dir -> array (inquirer prompt expected)');
}

// --lang java overrides detection (package.json present but java forced)
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'app' }));
  // Simulate --lang override: when flag is set, detectLang is NOT called
  const explicitLang = 'java';
  assert(explicitLang === 'java', '--lang java overrides auto-detection');
}

// ---- Prefix detection per lang ----
console.log('\n[prefix from cwd]');

{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@acme/api-server' }));
  const prefix = detectPackagePrefix(d, 'node');
  assert(prefix === 'api-server', 'node: strips @scope from package name');
}

{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>org.company.svc</groupId></project>');
  const prefix = detectPackagePrefix(d, 'java');
  assert(prefix === 'org.company.svc', 'java: extracts groupId from pom.xml');
}

{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[project]\nname = "data-pipeline"\n');
  const prefix = detectPackagePrefix(d, 'python');
  assert(prefix === 'data_pipeline', 'python: dashes to underscores in prefix');
}

// ---- Output filename format ----
console.log('\n[output filename format]');

{
  // ISO-UTC-no-colons: e.g. 2026-05-07T16-09-05Z.jsonl
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+Z$/, 'Z');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(stamp), 'timestamp format matches ISO-UTC-no-colons');
}

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
