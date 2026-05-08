/**
 * Unit tests for flowtrace run --lang java injection logic.
 * Tests the exported helpers from lib/commands/run.js without spawning a real JVM.
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// Load the module under test
const runCmd = require('../lib/commands/run');
const { _buildJavaInjection, _detectGroupIdFromPom, _ensureGitignore } = runCmd;

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }

// ─── _buildJavaInjection ──────────────────────────────────────────────────────

const FAKE_OTEL = '/repo/vendor/java/opentelemetry-javaagent.jar';
const FAKE_EXT  = '/repo/capture/java/flowtrace-otel-extension/target/flowtrace-otel-extension-2.0.0-SNAPSHOT.jar';
const PREFIX    = 'com.example';
const OUTPATH   = '/tmp/flowtrace/out.jsonl';

function baseOpts(extra = {}) {
  return {
    otelAgent: FAKE_OTEL,
    flExt: FAKE_EXT,
    prefix: PREFIX,
    outPath: OUTPATH,
    strategy: 'auto',
    ...extra,
  };
}

test('java -jar: flags spliced into argv (auto strategy)', () => {
  const { cmd, args, env } = _buildJavaInjection({
    ...baseOpts({ userArgs: ['java', '-jar', 'app.jar'] }),
  });
  assert.equal(cmd, 'java');
  assert.ok(args.includes(`-javaagent:${FAKE_OTEL}`), '-javaagent present');
  assert.ok(args.includes(`-Dotel.javaagent.extensions=${FAKE_EXT}`), 'extensions present');
  assert.ok(args.includes('-Dotel.traces.exporter=none'), 'traces exporter disabled');
  assert.ok(args.includes('-Dotel.metrics.exporter=none'), 'metrics exporter disabled');
  assert.ok(args.includes('-Dotel.logs.exporter=none'), 'logs exporter disabled');
  assert.ok(args.includes(`-Dflowtrace.package-prefix=${PREFIX}`), 'prefix present');
  assert.ok(args.includes(`-Dflowtrace.output=${OUTPATH}`), 'output present');
  // -jar must still be in the args (after the injected flags)
  assert.ok(args.includes('-jar'), '-jar preserved');
  assert.ok(args.includes('app.jar'), 'app.jar preserved');
  // Flags should NOT be in env when using java strategy
  assert.ok(!env.JAVA_TOOL_OPTIONS || !env.JAVA_TOOL_OPTIONS.includes('-javaagent'), 'no JAVA_TOOL_OPTIONS for direct java');
});

test('mvn command: flags go into MAVEN_OPTS (auto strategy)', () => {
  const { cmd, args, env } = _buildJavaInjection({
    ...baseOpts({ userArgs: ['mvn', 'spring-boot:run'] }),
  });
  assert.equal(cmd, 'mvn');
  assert.deepEqual(args, ['spring-boot:run']);
  assert.ok(env.MAVEN_OPTS.includes(`-javaagent:${FAKE_OTEL}`), 'MAVEN_OPTS has -javaagent');
  assert.ok(env.MAVEN_OPTS.includes(`-Dotel.javaagent.extensions=${FAKE_EXT}`), 'MAVEN_OPTS has extensions');
  assert.ok(env.MAVEN_OPTS.includes(`-Dflowtrace.package-prefix=${PREFIX}`), 'MAVEN_OPTS has prefix');
  assert.ok(env.MAVEN_OPTS.includes(`-Dflowtrace.output=${OUTPATH}`), 'MAVEN_OPTS has output');
});

test('mvn strategy explicit: flags go into MAVEN_OPTS regardless of binary name', () => {
  const { cmd, args, env } = _buildJavaInjection({
    ...baseOpts({ strategy: 'mvn', userArgs: ['./mvnw', 'spring-boot:run'] }),
  });
  assert.ok(env.MAVEN_OPTS.includes('-javaagent:'), 'MAVEN_OPTS set for explicit mvn strategy');
});

test('gradle command: flags go into JAVA_TOOL_OPTIONS (auto strategy)', () => {
  const { env } = _buildJavaInjection({
    ...baseOpts({ userArgs: ['gradle', 'bootRun'] }),
  });
  assert.ok(env.JAVA_TOOL_OPTIONS.includes(`-javaagent:${FAKE_OTEL}`), 'JAVA_TOOL_OPTIONS has -javaagent');
});

test('gradle strategy explicit: flags go into JAVA_TOOL_OPTIONS', () => {
  const { env } = _buildJavaInjection({
    ...baseOpts({ strategy: 'gradle', userArgs: ['./gradlew', 'bootRun'] }),
  });
  assert.ok(env.JAVA_TOOL_OPTIONS.includes('-javaagent:'), 'JAVA_TOOL_OPTIONS set for explicit gradle');
});

test('java strategy explicit: flags spliced into argv', () => {
  const { cmd, args } = _buildJavaInjection({
    ...baseOpts({ strategy: 'java', userArgs: ['java', '-cp', 'classes', 'com.example.Main'] }),
  });
  assert.equal(cmd, 'java');
  assert.ok(args.includes(`-javaagent:${FAKE_OTEL}`), '-javaagent in argv');
  assert.ok(args.includes('-cp'), '-cp preserved');
});

test('generic fallback: unknown binary uses JAVA_TOOL_OPTIONS', () => {
  const { cmd, env } = _buildJavaInjection({
    ...baseOpts({ userArgs: ['myrunner', 'start'] }),
  });
  assert.equal(cmd, 'myrunner');
  assert.ok(env.JAVA_TOOL_OPTIONS.includes('-javaagent:'), 'JAVA_TOOL_OPTIONS fallback');
});

test('--package-prefix overrides pom scan', () => {
  const { args, env } = _buildJavaInjection({
    ...baseOpts({
      prefix: 'org.override',
      userArgs: ['java', '-jar', 'foo.jar'],
    }),
  });
  const allTokens = [...args, ...(env.MAVEN_OPTS || '').split(' ')];
  const hasOverride = allTokens.some(t => t.includes('org.override'));
  assert.ok(hasOverride, 'override prefix present');
});

// ─── _detectGroupIdFromPom ────────────────────────────────────────────────────

test('detectGroupIdFromPom: extracts groupId from valid pom.xml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  fs.writeFileSync(path.join(tmp, 'pom.xml'), `
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.mycompany</groupId>
  <artifactId>myapp</artifactId>
</project>`);
  const result = _detectGroupIdFromPom(tmp);
  fs.rmSync(tmp, { recursive: true });
  assert.equal(result, 'io.mycompany');
});

test('detectGroupIdFromPom: returns null when no pom.xml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  const result = _detectGroupIdFromPom(tmp);
  fs.rmSync(tmp, { recursive: true });
  assert.equal(result, null);
});

// ─── _ensureGitignore ─────────────────────────────────────────────────────────

test('ensureGitignore: appends .flowtrace/ when not present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  fs.mkdirSync(path.join(tmp, '.git'));
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
  _ensureGitignore(tmp);
  const content = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
  assert.ok(content.includes('.flowtrace/'), '.flowtrace/ appended');
  fs.rmSync(tmp, { recursive: true });
});

test('ensureGitignore: idempotent — does not duplicate entry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  fs.mkdirSync(path.join(tmp, '.git'));
  fs.writeFileSync(path.join(tmp, '.gitignore'), '.flowtrace/\n');
  _ensureGitignore(tmp);
  _ensureGitignore(tmp);
  const lines = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8').split('\n').filter(Boolean);
  const count = lines.filter(l => l.trim() === '.flowtrace/').length;
  assert.equal(count, 1, 'entry appears exactly once');
  fs.rmSync(tmp, { recursive: true });
});

test('ensureGitignore: creates .gitignore when absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  fs.mkdirSync(path.join(tmp, '.git'));
  _ensureGitignore(tmp);
  const content = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
  assert.ok(content.includes('.flowtrace/'));
  fs.rmSync(tmp, { recursive: true });
});

test('ensureGitignore: no-op when no .git directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
  _ensureGitignore(tmp); // should not throw
  assert.ok(!fs.existsSync(path.join(tmp, '.gitignore')));
  fs.rmSync(tmp, { recursive: true });
});

// ─── runner ──────────────────────────────────────────────────────────────────

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
