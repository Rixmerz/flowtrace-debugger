/**
 * `flowtrace run` — Java injection via OpenTelemetry agent + FlowTrace extension.
 * Python / Node / TS paths reserved for S3-S4.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const chalk = require('chalk');

const SUPPORTED_LANGS = new Set(['java', 'python', 'node', 'ts']);

// ---------- helpers ----------

/**
 * Locate a file relative to the directory of this module's repo root.
 * Works whether the CLI is run from any cwd.
 */
function repoRoot() {
  // This file is at <repo>/flowtrace-cli/lib/commands/run.js
  return path.resolve(__dirname, '..', '..', '..'); // <repo>
}

/**
 * Scan the first pom.xml found in cwd for <groupId>.
 * Returns null if not found or xml unreadable.
 */
function detectGroupIdFromPom(cwd) {
  const pomPath = path.join(cwd, 'pom.xml');
  if (!fs.existsSync(pomPath)) return null;
  const src = fs.readFileSync(pomPath, 'utf-8');
  // Simple regex — avoids adding xml parser dependency
  const m = src.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/);
  return m ? m[1].trim() : null;
}

/**
 * Auto-add .flowtrace/ to .gitignore if inside a git repo.
 * Idempotent.
 */
function ensureGitignore(cwd) {
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) return;
  const giPath = path.join(cwd, '.gitignore');
  const entry = '.flowtrace/';
  if (fs.existsSync(giPath)) {
    const content = fs.readFileSync(giPath, 'utf-8');
    if (content.split('\n').some(l => l.trim() === entry)) return;
    fs.appendFileSync(giPath, `\n${entry}\n`);
  } else {
    fs.writeFileSync(giPath, `${entry}\n`);
  }
}

// ---------- injection strategies ----------

/**
 * Build argv + env for Java injection.
 * @param {object} opts
 * @param {string} opts.otelAgent  - absolute path to otel agent jar
 * @param {string} opts.flExt     - absolute path to flowtrace extension jar
 * @param {string} opts.prefix    - package prefix
 * @param {string} opts.outPath   - absolute path to output JSONL
 * @param {string} opts.strategy  - 'java' | 'mvn' | 'gradle' | 'auto'
 * @param {string[]} opts.userArgs - original user command tokens
 * @returns {{ cmd: string, args: string[], env: object }}
 */
function buildJavaInjection({ otelAgent, flExt, prefix, outPath, strategy, userArgs }) {
  const jvmFlags = [
    `-javaagent:${otelAgent}`,
    `-Dotel.javaagent.extensions=${flExt}`,
    `-Dotel.traces.exporter=none`,
    `-Dotel.metrics.exporter=none`,
    `-Dotel.logs.exporter=none`,
    `-Dflowtrace.package-prefix=${prefix}`,
    `-Dflowtrace.output=${outPath}`,
  ];

  const env = { ...process.env };
  const [first, ...rest] = userArgs;

  // Explicit strategy overrides
  if (strategy === 'mvn') {
    const existing = env.MAVEN_OPTS || '';
    env.MAVEN_OPTS = (existing + ' ' + jvmFlags.join(' ')).trim();
    return { cmd: first, args: rest, env };
  }
  if (strategy === 'gradle') {
    const existing = env.JAVA_TOOL_OPTIONS || '';
    env.JAVA_TOOL_OPTIONS = (existing + ' ' + jvmFlags.join(' ')).trim();
    return { cmd: first, args: rest, env };
  }

  // Auto-detect
  const bin = path.basename(first);

  if (strategy === 'java' || bin === 'java') {
    // Splice flags immediately after "java", before any -jar / main class
    return { cmd: first, args: [...jvmFlags, ...rest], env };
  }
  if (bin === 'mvn' || bin === 'mvnw') {
    const existing = env.MAVEN_OPTS || '';
    env.MAVEN_OPTS = (existing + ' ' + jvmFlags.join(' ')).trim();
    return { cmd: first, args: rest, env };
  }
  if (bin === 'gradle' || bin === 'gradlew') {
    const existing = env.JAVA_TOOL_OPTIONS || '';
    env.JAVA_TOOL_OPTIONS = (existing + ' ' + jvmFlags.join(' ')).trim();
    return { cmd: first, args: rest, env };
  }

  // Generic fallback: JAVA_TOOL_OPTIONS works for any JVM launcher
  const existing = env.JAVA_TOOL_OPTIONS || '';
  env.JAVA_TOOL_OPTIONS = (existing + ' ' + jvmFlags.join(' ')).trim();
  return { cmd: first, args: rest, env };
}

// ---------- main command ----------

async function runCommand(options = {}, restArgs = []) {
  const cwd = process.cwd();

  // Read config
  const cfgPath = path.join(cwd, '.flowtrace', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(chalk.red('Error:'), 'FlowTrace no está inicializado.');
    console.log(chalk.gray('Ejecuta: flowtrace init'));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

  const lang = options.lang || config.lang || 'auto';
  if (lang !== 'auto' && !SUPPORTED_LANGS.has(lang)) {
    console.error(chalk.red('Error:'), `Lenguaje no soportado: ${lang}`);
    console.log(chalk.gray(`Soportados: ${[...SUPPORTED_LANGS].join(', ')}`));
    process.exit(2);
  }

  // Build output path
  const outDir = path.join(cwd, '.flowtrace');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = options.out || path.join(outDir, `${stamp}.jsonl`);

  // Auto-add .flowtrace/ to .gitignore
  ensureGitignore(cwd);

  // ---- Java path ----
  if (lang === 'java') {
    return runJava({ options, restArgs, cwd, outPath });
  }

  // ---- Other langs: stub (S3-S4) ----
  console.log(chalk.cyan('FlowTrace v2 run'));
  console.log(chalk.gray(`  lang  : ${lang}`));
  console.log(chalk.gray(`  out   : ${outPath}`));
  console.log(chalk.gray(`  args  : ${restArgs.join(' ') || '(none)'}`));
  console.log(chalk.yellow(`  Soporte de ${lang} disponible en S3-S4.`));
  return { lang, outPath, args: restArgs };
}

async function runJava({ options, restArgs, cwd, outPath }) {
  const root = repoRoot();

  // 1. Resolve jar paths
  const otelAgent = path.join(root, 'flowtrace-cli', 'vendor', 'java', 'opentelemetry-javaagent.jar');
  const flExt = path.join(root, 'capture', 'java', 'flowtrace-otel-extension', 'target',
    'flowtrace-otel-extension-2.0.0-SNAPSHOT.jar');

  if (!fs.existsSync(otelAgent)) {
    console.error(chalk.red('Error:'), `No se encontró el agente OTel: ${otelAgent}`);
    console.log(chalk.gray('Ejecuta: make build   (o: make fetch-deps) en flowtrace-cli/'));
    process.exit(1);
  }
  if (!fs.existsSync(flExt)) {
    console.error(chalk.red('Error:'), `No se encontró la extensión FlowTrace: ${flExt}`);
    console.log(chalk.gray('Ejecuta: make build   en flowtrace-cli/  (o mvn package en capture/java/flowtrace-otel-extension/)'));
    process.exit(1);
  }

  // 2. Detect package prefix
  let prefix = options.packagePrefix || options['package-prefix'];
  if (!prefix) {
    prefix = detectGroupIdFromPom(cwd);
    if (!prefix) {
      console.error(chalk.red('Error:'), 'No se pudo detectar el package prefix automáticamente.');
      console.log(chalk.gray('Usa: flowtrace run --java --package-prefix com.miempresa -- java -jar app.jar'));
      process.exit(1);
    }
    console.log(chalk.gray(`  prefix (pom.xml): ${prefix}`));
  }

  // 3. Validate user args
  if (!restArgs.length) {
    console.error(chalk.red('Error:'), 'Debes proporcionar el comando a ejecutar después de --.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang java -- java -jar app.jar'));
    process.exit(1);
  }

  // 4. Build injection
  const strategy = options.inject || 'auto';
  const { cmd, args, env } = buildJavaInjection({
    otelAgent, flExt, prefix, outPath, strategy, userArgs: restArgs,
  });

  console.log(chalk.cyan('FlowTrace v2 — Java instrumentado'));
  console.log(chalk.gray(`  extension : ${path.basename(flExt)}`));
  console.log(chalk.gray(`  prefix    : ${prefix}`));
  console.log(chalk.gray(`  estrategia: ${strategy === 'auto' ? 'auto (' + path.basename(cmd) + ')' : strategy}`));
  console.log(chalk.gray(`  salida    : ${outPath}`));

  // 5. Spawn child inheriting stdio
  const child = spawn(cmd, args, { env, stdio: 'inherit' });

  // 6. Forward SIGINT so child can flush JSONL
  process.on('SIGINT', () => child.kill('SIGINT'));

  return new Promise((resolve) => {
    child.on('close', (code) => {
      process.exit(code ?? 0);
      resolve();
    });
  });
}

// Export internals for testing
runCommand._buildJavaInjection = buildJavaInjection;
runCommand._detectGroupIdFromPom = detectGroupIdFromPom;
runCommand._ensureGitignore = ensureGitignore;

module.exports = runCommand;
