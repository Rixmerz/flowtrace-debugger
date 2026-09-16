/**
 * Which extension jar the CLI loads.
 *
 * Regression test for a bug that produced no error at all. `mvn package` does
 * not clean target/, so after a version bump the previous release's jar is
 * still there next to the new one. Resolution was "newest matching mtime",
 * and during the test phase of the first build after a bump the ONLY match is
 * the old jar — so Java tracing silently ran old capture code: arg0/arg1
 * instead of parameter names, arrays serialized as the string "[]", and
 * virtual-thread call paths landing in a disconnected trace. Every symptom
 * read as a product regression.
 *
 * Run: node test/test-java-jar-resolution.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { javaExtensionVersion, _pickJavaExtensionJar } = require('../lib/assets');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-jar-'));
}

/** Writes a file and backdates or forward-dates it, so mtime is controlled. */
function touchJar(dir, name, mtimeMs) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'not really a jar');
  fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

const POM = (version) => `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>io.flowtrace</groupId>
  <artifactId>flowtrace-otel-extension</artifactId>
  <version>${version}</version>
  <packaging>jar</packaging>
</project>
`;

console.log('\n[javaExtensionVersion]');

test('reads the version from the extension pom', () => {
  const d = mkTmp();
  const pom = path.join(d, 'pom.xml');
  fs.writeFileSync(pom, POM('2.2.0'));
  assert.equal(javaExtensionVersion(pom), '2.2.0');
});

test('is not fooled by the other <version> elements a pom carries', () => {
  const d = mkTmp();
  const pom = path.join(d, 'pom.xml');
  fs.writeFileSync(pom, `<project>
  <artifactId>flowtrace-otel-extension</artifactId>
  <version>3.0.1</version>
  <dependencies><dependency>
    <artifactId>opentelemetry-api</artifactId>
    <version>1.61.0</version>
  </dependency></dependencies>
</project>`);
  assert.equal(javaExtensionVersion(pom), '3.0.1');
});

test('returns null when there is no pom (an installed package)', () => {
  assert.equal(javaExtensionVersion(path.join(mkTmp(), 'nope.xml')), null);
});

console.log('\n[_pickJavaExtensionJar — checkout]');

test('ignores a newer-mtime jar of the previous version', () => {
  const root = mkTmp();
  const built = path.join(root, 'target');
  // The stale jar is deliberately the NEWEST file: mtime used to decide.
  touchJar(built, 'flowtrace-otel-extension-2.0.0.jar', Date.now());
  const current = touchJar(built, 'flowtrace-otel-extension-2.2.0.jar', Date.now() - 86400_000);
  assert.equal(
    _pickJavaExtensionJar(built, path.join(root, 'vendor', 'java'), '2.2.0'),
    current);
});

test('returns null when only an older version is built, rather than using it', () => {
  const root = mkTmp();
  const built = path.join(root, 'target');
  touchJar(built, 'flowtrace-otel-extension-2.0.0.jar', Date.now());
  // This is the exact state of target/ during `mvn package`'s test phase on
  // the first build after a version bump.
  assert.equal(
    _pickJavaExtensionJar(built, path.join(root, 'vendor', 'java'), '2.2.0'),
    null);
});

test('skips the shade plugin\'s leftover original-*.jar', () => {
  const root = mkTmp();
  const built = path.join(root, 'target');
  touchJar(built, 'original-flowtrace-otel-extension-2.2.0.jar', Date.now());
  assert.equal(
    _pickJavaExtensionJar(built, path.join(root, 'vendor', 'java'), '2.2.0'),
    null);
});

test('prefers the checkout over a vendored copy of the same version', () => {
  const root = mkTmp();
  const built = path.join(root, 'target');
  const vendored = path.join(root, 'vendor', 'java');
  const fromBuild = touchJar(built, 'flowtrace-otel-extension-2.2.0.jar', Date.now() - 86400_000);
  touchJar(vendored, 'flowtrace-otel-extension-2.2.0.jar', Date.now());
  assert.equal(_pickJavaExtensionJar(built, vendored, '2.2.0'), fromBuild);
});

console.log('\n[_pickJavaExtensionJar — installed package]');

test('takes the single vendored jar when there is no pom to name it', () => {
  const root = mkTmp();
  const vendored = path.join(root, 'vendor', 'java');
  const only = touchJar(vendored, 'flowtrace-otel-extension-2.2.0.jar', Date.now());
  assert.equal(_pickJavaExtensionJar(path.join(root, 'target'), vendored, null), only);
});

test('refuses to choose when vendor/ holds more than one jar', () => {
  const root = mkTmp();
  const vendored = path.join(root, 'vendor', 'java');
  touchJar(vendored, 'flowtrace-otel-extension-2.0.0.jar', Date.now());
  touchJar(vendored, 'flowtrace-otel-extension-2.2.0.jar', Date.now() - 1000);
  // vendor.mjs wipes vendor/ before copying, so two jars means that broke.
  // Guessing is the bug this test exists for.
  assert.equal(_pickJavaExtensionJar(path.join(root, 'target'), vendored, null), null);
});

test('returns null when nothing is vendored at all', () => {
  const root = mkTmp();
  assert.equal(
    _pickJavaExtensionJar(path.join(root, 'target'), path.join(root, 'vendor', 'java'), null),
    null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
