#!/usr/bin/env node
/**
 * Generate or verify examples/golden/<lang>/expected.jsonl.
 *
 * Why: the golden READMEs describe expected.jsonl as "the spec", but no such
 * file was ever committed. validate-golden.mjs skipped every language and still
 * exited 0, so CI's first job reported success while validating nothing.
 *
 *   node scripts/golden.mjs generate [lang...]   # run each layer, write fixtures
 *   node scripts/golden.mjs verify   [lang...]   # run each layer, diff vs fixtures
 *
 * Traces are passed through scripts/normalize-trace.mjs first, which rewrites
 * the volatile fields (ids, timestamps, durations) while preserving event order,
 * the parent/child topology, depth, method identity, args and results. So the
 * fixture is stable across runs yet still schema-valid, and `verify` catches
 * behavioural regressions: a method that stopped being instrumented, a changed
 * arg shape, a broken parent chain.
 *
 * A language whose toolchain is missing is reported as SKIP and, in verify mode,
 * counted — never silently passed over. That pattern is exactly what hid the
 * three defects this file exists to prevent.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, symlinkSync, cpSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { normalize } from './normalize-trace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const goldenRoot = join(repoRoot, 'examples', 'golden');
const nodeCapture = join(repoRoot, 'capture', 'node');
const pyCapture = join(repoRoot, 'capture', 'python');
const javaExtDir = join(repoRoot, 'capture', 'java', 'flowtrace-otel-extension');

const BOOTSTRAP = join(nodeCapture, 'src', 'bootstrap.mjs');

/** Shared env for every runner: deterministic output location, no inherited carrier. */
function baseEnv(outPath, extra = {}) {
  const env = { ...process.env, FLOWTRACE_OUTPUT: outPath, NODE_OPTIONS: '' };
  // A carrier in the developer's shell would rewrite trace_id and parent_id and
  // silently change the fixture.
  delete env.FLOWTRACE_TRACEPARENT;
  return { ...env, ...extra };
}

function run(cmd, args, opts) {
  execFileSync(cmd, args, { stdio: 'pipe', timeout: 120000, ...opts });
}

// ── Per-language runners ─────────────────────────────────────────────
// Each returns the raw JSONL text, or throws { skip: reason }.

function runNode(work) {
  const out = join(work, 'trace.jsonl');
  run(process.execPath, ['--import', `file://${BOOTSTRAP}`, 'calculator.js'], {
    cwd: join(goldenRoot, 'node'),
    env: baseEnv(out, { FLOWTRACE_PACKAGE_PREFIX: '' }),
  });
  return readFileSync(out, 'utf8');
}

function runTs(work) {
  // The transform injects `import ... from '@flowtrace/capture-node/...'`, which
  // only resolves if the package is reachable from the source file. In a real
  // project it is a dependency; here we stage a copy of the fixture next to a
  // node_modules symlink so resolution succeeds without committing one.
  const stage = join(work, 'ts-stage');
  mkdirSync(join(stage, 'node_modules', '@flowtrace'), { recursive: true });
  symlinkSync(nodeCapture, join(stage, 'node_modules', '@flowtrace', 'capture-node'), 'dir');
  cpSync(join(goldenRoot, 'ts', 'calculator.ts'), join(stage, 'calculator.ts'));
  // Node cannot use a .ts file as an entry point, so import it — which is the
  // realistic shape anyway. The fixture executes itself on import, so the entry
  // needs nothing more than the import.
  writeFileSync(join(stage, 'entry.mjs'), "import './calculator.ts';\n");

  const out = join(work, 'trace.jsonl');
  run(process.execPath, ['--import', `file://${BOOTSTRAP}`, 'entry.mjs'], {
    cwd: stage,
    env: baseEnv(out, { FLOWTRACE_PACKAGE_PREFIX: '' }),
  });
  return readFileSync(out, 'utf8');
}

function runPython(work) {
  const out = join(work, 'trace.jsonl');
  run('python3', [join(goldenRoot, 'python', 'calculator.py')], {
    cwd: join(goldenRoot, 'python'),
    env: baseEnv(out, {
      PYTHONPATH: [join(pyCapture, 'stub'), pyCapture].join(':'),
      FLOWTRACE_ENABLE: '1',
      FLOWTRACE_PACKAGE_PREFIX: 'calculator',
    }),
  });
  return readFileSync(out, 'utf8');
}

function runJava(work) {
  const version = readFileSync(join(javaExtDir, 'pom.xml'), 'utf8')
    .match(/<artifactId>flowtrace-otel-extension<\/artifactId>\s*<version>([^<]+)<\/version>/)?.[1];
  const extJar = join(javaExtDir, 'target', `flowtrace-otel-extension-${version}.jar`);
  const agentJar = join(javaExtDir, 'target', 'dependency', 'opentelemetry-javaagent.jar');
  if (!version) throw { skip: 'could not read extension version from pom.xml' };
  if (!existsSync(extJar)) throw { skip: `extension jar missing (${extJar}) — run 'make build-java'` };
  if (!existsSync(agentJar)) throw { skip: `OTel agent jar missing — run 'mvn process-test-resources'` };

  // Calculator.java declares `package com.example.golden`, so javac/java need
  // the matching directory layout.
  const pkgDir = join(work, 'jsrc', 'com', 'example', 'golden');
  mkdirSync(pkgDir, { recursive: true });
  cpSync(join(goldenRoot, 'java', 'Calculator.java'), join(pkgDir, 'Calculator.java'));
  const src = join(work, 'jsrc');
  run('javac', ['com/example/golden/Calculator.java'], { cwd: src });

  const out = join(work, 'trace.jsonl');
  run('java', [
    `-javaagent:${agentJar}`,
    `-Dotel.javaagent.extensions=${extJar}`,
    '-Dflowtrace.package-prefix=com.example.golden',
    `-Dflowtrace.output=${out}`,
    '-Dotel.traces.exporter=none', '-Dotel.metrics.exporter=none',
    '-Dotel.logs.exporter=none', '-Dotel.javaagent.logging=none',
    'com.example.golden.Calculator',
  ], { cwd: src, env: baseEnv(out) });
  return readFileSync(out, 'utf8');
}

const RUNNERS = { node: runNode, ts: runTs, python: runPython, java: runJava };

// ── Driver ───────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode !== 'generate' && mode !== 'verify') {
  console.error('usage: node scripts/golden.mjs <generate|verify> [lang...]');
  process.exit(2);
}
const langs = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(RUNNERS);

let failures = 0;
let skipped = 0;

for (const lang of langs) {
  const runner = RUNNERS[lang];
  if (!runner) {
    console.error(`FAIL ${lang}: no runner defined`);
    failures += 1;
    continue;
  }

  const work = mkdtempSync(join(tmpdir(), `ft-golden-${lang}-`));
  let normalized;
  try {
    normalized = normalize(runner(work));
  } catch (e) {
    if (e && e.skip) {
      console.warn(`SKIP ${lang}: ${e.skip}`);
      skipped += 1;
      continue;
    }
    console.error(`FAIL ${lang}: ${e.message ?? e}`);
    if (e.stderr) console.error(String(e.stderr).split('\n').slice(0, 6).join('\n'));
    failures += 1;
    continue;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const fixture = join(goldenRoot, lang, 'expected.jsonl');

  if (mode === 'generate') {
    writeFileSync(fixture, normalized, 'utf8');
    const lines = normalized.trimEnd().split('\n').length;
    console.log(`WROTE ${lang}: ${lines} events -> ${fixture.slice(repoRoot.length + 1)}`);
    continue;
  }

  if (!existsSync(fixture)) {
    console.error(`FAIL ${lang}: no expected.jsonl — run 'node scripts/golden.mjs generate ${lang}'`);
    failures += 1;
    continue;
  }

  const expected = readFileSync(fixture, 'utf8');
  if (expected === normalized) {
    console.log(`OK    ${lang}: matches expected.jsonl`);
  } else {
    failures += 1;
    console.error(`FAIL ${lang}: output differs from expected.jsonl`);
    const a = expected.trimEnd().split('\n');
    const b = normalized.trimEnd().split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  line ${i + 1}:`);
        console.error(`    expected: ${a[i] ?? '<missing>'}`);
        console.error(`    actual:   ${b[i] ?? '<missing>'}`);
      }
    }
  }
}

if (skipped > 0) {
  console.log(`\n${skipped} language(s) skipped for missing toolchain — those are UNVERIFIED.`);
}
console.log(mode === 'generate' ? '\nDone.' : `\nFailures: ${failures}.`);
process.exit(failures === 0 ? 0 : 1);
