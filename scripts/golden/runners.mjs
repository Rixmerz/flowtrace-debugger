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
import { existsSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const GOLDEN_ROOT = join(REPO_ROOT, 'examples', 'golden');

const NODE_BOOTSTRAP = join(REPO_ROOT, 'capture', 'node', 'src', 'bootstrap.mjs');
const PY_STUB = join(REPO_ROOT, 'capture', 'python', 'stub');
const PY_PKG = join(REPO_ROOT, 'capture', 'python');
const GO_CAPTURE = join(REPO_ROOT, 'capture', 'go');
const GO_DRIVER = join(GO_CAPTURE, 'cmd', 'flowtrace-go');
const GO_RUNTIME_SRC = join(GO_CAPTURE, 'flowtracert');
const JAVA_MODULE = join(REPO_ROOT, 'capture', 'java', 'flowtrace-otel-extension');
const OTEL_AGENT = join(JAVA_MODULE, 'target', 'dependency', 'opentelemetry-javaagent.jar');

const TIMEOUT_MS = 90_000;

/** Locate the shaded extension jar without hardcoding a version. */
function extensionJar() {
  const targetDir = join(JAVA_MODULE, 'target');
  if (!existsSync(targetDir)) return null;
  // Most recently modified, not the first match: after a version bump target/
  // holds the previous jar too, and readdir order is filesystem-dependent — so
  // taking the first would silently run the golden fixtures against the old
  // agent and still report green.
  const hits = readdirSync(targetDir)
    .filter((n) => n.startsWith('flowtrace-otel-extension-') && n.endsWith('.jar') && !n.startsWith('original-'))
    .map((n) => join(targetDir, n));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (statSync(a).mtimeMs >= statSync(b).mtimeMs ? a : b));
}

// ── runner builders ──────────────────────────────────────────────

function nodeRunner({ id, script, maxArgLength, prefix = '', requiresDeps = false }) {
  const dir = join(GOLDEN_ROOT, id);
  return {
    id,
    dir,
    available() {
      if (!existsSync(join(dir, script))) return { ok: false, reason: `${script} missing` };
      if (!existsSync(NODE_BOOTSTRAP)) return { ok: false, reason: 'capture/node bootstrap missing' };
      if (requiresDeps && !existsSync(join(dir, 'node_modules'))) {
        return { ok: false, reason: 'dependencies not installed — run `pnpm install` at the repo root' };
      }
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
          FLOWTRACE_PACKAGE_PREFIX: prefix,
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

/**
 * Go fixture: driven through the real cmd/flowtrace-go driver, exactly as
 * flowtrace-cli's runGo does — `go run` executed with cwd = capture/go
 * (flowtrace-go's own module) and the fixture's directory passed through
 * the driver's own -dir flag, because `go run` resolves the *main module*
 * from its own working directory rather than from the package path it is
 * given (see flowtrace-cli/lib/commands/run.js's buildGoInvocation).
 */
function goRunner({ id, maxArgLength }) {
  const dir = join(GOLDEN_ROOT, id);
  return {
    id,
    dir,
    available() {
      if (!existsSync(join(dir, 'go.mod'))) return { ok: false, reason: 'go.mod missing' };
      if (!existsSync(GO_DRIVER)) return { ok: false, reason: 'capture/go/cmd/flowtrace-go missing' };
      return { ok: true };
    },
    run(outPath) {
      return spawnSync('go', [
        'run', GO_DRIVER,
        '-runtime-src', GO_RUNTIME_SRC,
        '-dir', dir,
        'run', '.',
      ], {
        cwd: GO_CAPTURE,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
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

/**
 * A fixture that is a single bare .java source with no build of its own: it is
 * compiled to a scratch directory, then run under the agent. The main class and
 * the instrumentation prefix are both the source's base name, since these live
 * in the default package.
 */
function javaSourceRunner({ id, source, maxArgLength }) {
  const dir = join(GOLDEN_ROOT, ...id.split('/'));
  const mainClass = source.replace(/\.java$/, '');
  return {
    id,
    dir,
    available() {
      const base = javaArtifactsAvailable();
      if (!base.ok) return base;
      if (!existsSync(join(dir, source))) return { ok: false, reason: `${source} missing` };
      return { ok: true };
    },
    run(outPath) {
      const classesDir = mkdtempSync(join(tmpdir(), 'ft-golden-java-'));
      const javac = spawnSync('javac', ['-d', classesDir, join(dir, source)], {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
      });
      if (javac.status !== 0) {
        return { status: javac.status, stdout: javac.stdout, stderr: `javac failed:\n${javac.stderr}` };
      }
      return javaSpawn({
        classpath: classesDir,
        mainClass,
        prefix: mainClass,
        outPath,
        maxArgLength,
      });
    },
  };
}

/** Every golden fixture that must have a committed expected.jsonl. */
export const FIXTURES = [
  pythonRunner({ id: 'python', script: 'calculator.py', prefix: 'calculator' }),
  goRunner({ id: 'go' }),
  nodeRunner({ id: 'node', script: 'calculator.js' }),
  nodeRunner({ id: 'ts', script: 'calculator.ts' }),
  // Express: user code inside a real framework request cycle. The prefix scopes
  // instrumentation to app.js so neither the harness nor Express's own
  // internals enter the trace, keeping the event sequence deterministic.
  nodeRunner({
    id: 'express',
    script: 'run.js',
    prefix: 'app.js',
    requiresDeps: true,
  }),
  javaGolden,
  pythonRunner({
    id: 'truncation/python',
    script: 'long_arg_fixture.py',
    prefix: 'long_arg_fixture',
    maxArgLength: 64,
  }),
  nodeRunner({ id: 'truncation/node', script: 'longArgFixture.js', maxArgLength: 64 }),
  javaSourceRunner({ id: 'truncation/java', source: 'LongArgFixture.java', maxArgLength: 64 }),
  // Error path. Until these existed no fixture in any language exercised a
  // failing call, so the `error` field went unverified everywhere — which is
  // how Java and Node came to emit exit events missing the required `result`,
  // and Python came to hide the error inside `result` where no consumer looked.
  pythonRunner({ id: 'error/python', script: 'error_fixture.py', prefix: 'error_fixture' }),
  nodeRunner({ id: 'error/node', script: 'errorFixture.js' }),
  javaSourceRunner({ id: 'error/java', source: 'ErrorFixture.java' }),
];

export const FIXTURE_IDS = FIXTURES.map((f) => f.id);
