/**
 * Tests for lib/detect.js
 * Run: node test/test-detect.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { detectLang, detectPackagePrefix, nodePackageName } = require('../lib/detect');

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
  // The Node capture layer matches the prefix as a PATH substring
  // (capture/node/src/cjs/hook.js: filename.includes(prefix)), so the project
  // directory is the value that actually instruments anything. Returning the
  // package name only worked when the directory happened to share it.
  assert(detectPackagePrefix(d, 'node') === d, 'node: prefix is the project directory');
}

// Node scoped package name strip
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@org/my-lib' }));
  assert(detectPackagePrefix(d, 'node') === d, 'node: scoped package still yields the directory');
  assert(nodePackageName(d) === 'my-lib', 'node: the display name still strips @scope');
}

// Node no name
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({}));
  assert(detectPackagePrefix(d, 'node') === d, 'node: a package.json without a name still yields the directory');
  assert(nodePackageName(d) === null, 'node: no name -> no display name');
}

// Unknown lang
{
  const d = mkTmp();
  assert(detectPackagePrefix(d, 'cobol') === null, 'unknown lang -> null');
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

// Rust: Cargo.toml -> rust, prefix is the [package] name with - as _
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'Cargo.toml'), `[package]\nname = "kerno-core"\nversion = "0.1.0"\n\n[[bin]]\nname = "other"\n`);
  assert(detectLang(d) === 'rust', 'Cargo.toml -> rust');
  assert(detectPackagePrefix(d, 'rust') === 'kerno_core', 'rust: [package] name, hyphens as underscores, not a later [[bin]] name');
}

// Rust: a virtual workspace has no package name; the driver derives the prefix itself
{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'Cargo.toml'), `[workspace]\nmembers = ["crates/*"]\n`);
  assert(detectLang(d) === 'rust', 'virtual workspace -> rust');
  assert(detectPackagePrefix(d, 'rust') === null, 'rust: workspace root has no [package] -> null');
}

// Rust: no Cargo.toml -> null
{
  const d = mkTmp();
  assert(detectPackagePrefix(d, 'rust') === null, 'rust: no Cargo.toml -> null');
}

// Java pom.xml: parent groupId must not win; sources decide
{
  const mk = (pom, files) => {
    const d = mkTmp();
    fs.writeFileSync(path.join(d, 'pom.xml'), pom);
    for (const f of files) {
      const fp = path.join(d, 'src/main/java', f);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, '');
    }
    return d;
  };
  const parent = '<parent><groupId>org.springframework.boot</groupId><artifactId>p</artifactId></parent>';
  const petFiles = ['org/springframework/samples/petclinic/PetClinicApp.java',
    'org/springframework/samples/petclinic/owner/Owner.java',
    'org/springframework/samples/petclinic/vet/Vet.java'];
  let d = mk(`<project>${parent}<artifactId>pc</artifactId></project>`, petFiles);
  assert(detectPackagePrefix(d, 'java') === 'org.springframework.samples.petclinic', 'java: no own groupId -> common package of sources, not parent groupId');
  d = mk(`<project>${parent}<groupId>org.springframework.samples</groupId></project>`, petFiles);
  assert(detectPackagePrefix(d, 'java') === 'org.springframework.samples', 'java: own groupId used when sources live under it');
  d = mk(`<project>${parent}<groupId>com.unrelated</groupId></project>`, petFiles);
  assert(detectPackagePrefix(d, 'java') === 'org.springframework.samples.petclinic', 'java: own groupId matching no source -> common package');
  d = mk(`<project>${parent}<groupId>com.x</groupId><dependencies><dependency><groupId>junk</groupId></dependency></dependencies></project>`, []);
  assert(detectPackagePrefix(d, 'java') === 'com.x', 'java: own groupId, no sources -> groupId (dependency groupIds ignored)');
  d = mk(`<project>${parent}</project>`, []);
  assert(detectPackagePrefix(d, 'java') === null, 'java: only parent groupId, no sources -> null');
}

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
