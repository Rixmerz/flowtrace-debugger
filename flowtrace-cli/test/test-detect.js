/**
 * Tests for lib/detect.js
 * Run: node test/test-detect.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-detect-'));
}

function touch(dir, ...files) {
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f), '');
  }
}

// ---- detectLang ----
console.log('\n[detectLang]');

{
  const d = mkTmp();
  assert(detectLang(d) === null, 'empty dir -> null');
}

{
  const d = mkTmp();
  touch(d, 'pom.xml');
  assert(detectLang(d) === 'java', 'pom.xml -> java');
}

{
  const d = mkTmp();
  touch(d, 'build.gradle');
  assert(detectLang(d) === 'java', 'build.gradle -> java');
}

{
  const d = mkTmp();
  touch(d, 'build.gradle.kts');
  assert(detectLang(d) === 'java', 'build.gradle.kts -> java');
}

{
  const d = mkTmp();
  touch(d, 'pyproject.toml');
  assert(detectLang(d) === 'python', 'pyproject.toml -> python');
}

{
  const d = mkTmp();
  touch(d, 'setup.py');
  assert(detectLang(d) === 'python', 'setup.py -> python');
}

{
  const d = mkTmp();
  touch(d, 'requirements.txt');
  assert(detectLang(d) === 'python', 'requirements.txt -> python');
}

{
  const d = mkTmp();
  touch(d, 'package.json');
  assert(detectLang(d) === 'node', 'package.json only -> node');
}

{
  const d = mkTmp();
  touch(d, 'package.json', 'tsconfig.json');
  assert(detectLang(d) === 'ts', 'package.json + tsconfig.json -> ts');
}

{
  const d = mkTmp();
  touch(d, 'package.json', 'pyproject.toml');
  const result = detectLang(d);
  assert(Array.isArray(result), 'package.json + pyproject.toml -> array (multi-lang)');
  assert(Array.isArray(result) && result.includes('python'), 'multi-lang includes python');
  assert(Array.isArray(result) && result.includes('node'), 'multi-lang includes node');
}

// ---- detectPackagePrefix ----
console.log('\n[detectPackagePrefix]');

// Java pom.xml groupId
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pom.xml'), `
<project>
  <groupId>com.example.myapp</groupId>
  <artifactId>demo</artifactId>
</project>`);
  assert(detectPackagePrefix(d, 'java') === 'com.example.myapp', 'java: pom.xml groupId extracted');
}

// Java build.gradle group
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'build.gradle'), `group = 'io.acme'\nversion = '1.0'\n`);
  assert(detectPackagePrefix(d, 'java') === 'io.acme', 'java: build.gradle group extracted');
}

// Java no marker
{
  const d = mkTmp();
  assert(detectPackagePrefix(d, 'java') === null, 'java: no files -> null');
}

// Python pyproject.toml
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'pyproject.toml'), `[project]\nname = "my-cool-pkg"\nversion = "0.1"\n`);
  assert(detectPackagePrefix(d, 'python') === 'my_cool_pkg', 'python: pyproject.toml name (dashes to underscores)');
}

// Python setup.py
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'setup.py'), `setup(name='mylib', version='1')\n`);
  assert(detectPackagePrefix(d, 'python') === 'mylib', 'python: setup.py name extracted');
}

// Node package.json plain name
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'my-app' }));
  assert(detectPackagePrefix(d, 'node') === 'my-app', 'node: package.json plain name');
}

// Node scoped package name strip
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@org/my-lib' }));
  assert(detectPackagePrefix(d, 'node') === 'my-lib', 'node: scoped name @org/my-lib -> my-lib');
}

// Node no name
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({}));
  assert(detectPackagePrefix(d, 'node') === null, 'node: package.json without name -> null');
}

// Unknown lang
{
  const d = mkTmp();
  assert(detectPackagePrefix(d, 'rust') === null, 'unknown lang -> null');
}

// Go go.mod module path
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'go.mod'), `module github.com/acme/widget\n\ngo 1.24\n`);
  assert(detectLang(d) === 'go', 'go.mod -> go');
  assert(detectPackagePrefix(d, 'go') === 'github.com/acme/widget', 'go: go.mod module path extracted');
}

// Go: no go.mod -> null
{
  const d = mkTmp();
  assert(detectPackagePrefix(d, 'go') === null, 'go: no go.mod -> null');
}

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
