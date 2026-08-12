/**
 * Registry of golden fixtures and how to execute each one under its capture
 * layer. Shared by `gen-golden.mjs` (writes expected.jsonl) and
 * `check-golden.mjs` (re-runs and diffs against it), so the fixture can never
 * drift from the command that produced it.
 *
 * Each entry exposes:
 *   id        — fixture path relative to examples/golden
 *   available() -> { ok, reason }   build artifacts present?
 *   run(outPath) -> { status, stdout, stderr }
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const GOLDEN_ROOT = join(REPO_ROOT, 'examples', 'golden');

const NODE_BOOTSTRAP = join(REPO_ROOT, 'capture', 'node', 'src', 'bootstrap.mjs');
const PY_STUB = join(REPO_ROOT, 'capture', 'python', 'stub');
const PY_PKG = join(REPO_ROOT, 'capture', 'python');
const JAVA_MODULE = join(REPO_ROOT, 'capture', 'java', 'flowtrace-otel-extension');
const OTEL_AGENT = join(JAVA_MODULE, 'target', 'dependency', 'opentelemetry-javaagent.jar');

const TIMEOUT_MS = 90_000;

/** Locate the shaded extension jar without hardcoding a version. */
function extensionJar() {
  const targetDir = join(JAVA_MODULE, 'target');
  if (!existsSync(targetDir)) return null;
  const hit = readdirSync(targetDir).find(
    (n) => n.startsWith('flowtrace-otel-extension-') && n.endsWith('.jar') && !n.startsWith('original-')
  );
  return hit ? join(targetDir, hit) : null;
}

// ── runner builders ──────────────────────────────────────────────

function nodeRunner({ id, script, maxArgLength }) {
  const dir = join(GOLDEN_ROOT, id);
  return {
    id,
    dir,
    available() {
      if (!existsSync(join(dir, script))) return { ok: false, reason: `${script} missing` };
      if (!existsSync(NODE_BOOTSTRAP)) return { ok: false, reason: 'capture/node bootstrap missing' };
      return { ok: true };
    },
    run(outPath) {
      return spawnSync(process.execPath, ['--import', `file://${NODE_BOOTSTRAP}`, script], {
        cwd: dir,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
          FLOWTRACE_OUTPUT: outPath,
          FLOWTRACE_PACKAGE_PREFIX: '',
          ...(maxArgLength ? { FLOWTRACE_MAX_ARG_LENGTH: String(maxArgLength) } : {}),
          NODE_OPTIONS: '',
        },
      });
    },
  };
}

function pythonRunner({ id, script, prefix, maxArgLength }) {
  const dir = join(GOLDEN_ROOT, id);
  return {
    id,
    dir,
    available() {
      if (!existsSync(join(dir, script))) return { ok: false, reason: `${script} missing` };
      if (!existsSync(PY_STUB)) return { ok: false, reason: 'capture/python stub missing' };
      return { ok: true };
    },
    run(outPath) {
      const python = process.env.PYTHON ?? 'python3';
      return spawnSync(python, [script], {
        cwd: dir,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
          PYTHONPATH: [PY_STUB, PY_PKG, process.env.PYTHONPATH].filter(Boolean).join(':'),
          FLOWTRACE_ENABLE: '1',
          FLOWTRACE_PACKAGE_PREFIX: prefix,
          FLOWTRACE_OUTPUT: outPath,
          ...(maxArgLength ? { FLOWTRACE_MAX_ARG_LENGTH: String(maxArgLength) } : {}),
        },
      });
    },
  };
}

/** Shared JVM invocation: OTel agent + FlowTrace extension. */
function javaSpawn({ classpath, mainClass, prefix, outPath, maxArgLength }) {
  const jar = extensionJar();
  const args = [
    `-javaagent:${OTEL_AGENT}`,
    `-Dotel.javaagent.extensions=${jar}`,
    '-Dotel.traces.exporter=none',
    '-Dotel.metrics.exporter=none',
    '-Dotel.logs.exporter=none',
    '-Dotel.javaagent.logging=none',
    `-Dflowtrace.package-prefix=${prefix}`,
    `-Dflowtrace.output=${outPath}`,
  ];
  if (maxArgLength) args.push(`-Dflowtrace.max-arg-length=${maxArgLength}`);
  args.push('-cp', classpath, mainClass);

  return spawnSync('java', args, {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: {
      ...process.env,
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    },
  });
}

function javaArtifactsAvailable() {
  if (!existsSync(OTEL_AGENT)) {
    return { ok: false, reason: 'OTel agent jar absent — run `mvn process-test-resources` (needs network)' };
  }
  if (!extensionJar()) {
    return { ok: false, reason: 'extension jar not built — run `make build-java`' };
  }
  return { ok: true };
}

const javaGolden = {
  id: 'java',
  dir: join(GOLDEN_ROOT, 'java'),
  available() {
    const base = javaArtifactsAvailable();
    if (!base.ok) return base;
    if (!existsSync(join(JAVA_MODULE, 'target', 'test-classes'))) {
      return { ok: false, reason: 'target/test-classes absent — run `make build-java`' };
    }
    return { ok: true };
  },
  run(outPath) {
    // CalcRunner deliberately sits outside the instrumented prefix, so only
    // Calculator's methods are captured — exactly 8 events.
    return javaSpawn({
      classpath: join(JAVA_MODULE, 'target', 'test-classes'),
      mainClass: 'io.flowtrace.runner.CalcRunner',
      prefix: 'com.example.golden',
      outPath,
    });
  },
};

const javaTruncation = {
  id: 'truncation/java',
  dir: join(GOLDEN_ROOT, 'truncation', 'java'),
  available() {
    const base = javaArtifactsAvailable();
    if (!base.ok) return base;
    if (!existsSync(join(this.dir, 'LongArgFixture.java'))) {
      return { ok: false, reason: 'LongArgFixture.java missing' };
    }
    return { ok: true };
  },
  run(outPath) {
    // The truncation fixture is a bare .java source with no build of its own;
    // compile it to a scratch dir first.
    const classesDir = mkdtempSync(join(tmpdir(), 'ft-trunc-java-'));
    const javac = spawnSync('javac', ['-d', classesDir, join(this.dir, 'LongArgFixture.java')], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
    });
    if (javac.status !== 0) {
      return { status: javac.status, stdout: javac.stdout, stderr: `javac failed:\n${javac.stderr}` };
    }
    return javaSpawn({
      classpath: classesDir,
      mainClass: 'LongArgFixture',
      prefix: 'LongArgFixture',
      outPath,
      maxArgLength: 64,
    });
  },
};

/** Every golden fixture that must have a committed expected.jsonl. */
export const FIXTURES = [
  pythonRunner({ id: 'python', script: 'calculator.py', prefix: 'calculator' }),
  nodeRunner({ id: 'node', script: 'calculator.js' }),
  nodeRunner({ id: 'ts', script: 'calculator.ts' }),
  javaGolden,
  pythonRunner({
    id: 'truncation/python',
    script: 'long_arg_fixture.py',
    prefix: 'long_arg_fixture',
    maxArgLength: 64,
  }),
  nodeRunner({ id: 'truncation/node', script: 'longArgFixture.js', maxArgLength: 64 }),
  javaTruncation,
];

export const FIXTURE_IDS = FIXTURES.map((f) => f.id);
