/**
 * `flowtrace run` — Java injection via OpenTelemetry agent + FlowTrace extension.
 * Python / Node / TS paths reserved for S3-S4.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const chalk = require('chalk');
const { detectLang, detectPackagePrefix } = require('../detect');

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

  // Read config (optional in v2 — auto-init if missing)
  const cfgPath = path.join(cwd, '.flowtrace', 'config.json');
  let config = {};
  if (fs.existsSync(cfgPath)) {
    config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }

  // Determine language: CLI flag > config > auto-detect
  let lang = options.lang || config.lang || null;
  if (!lang || lang === 'auto') {
    const detected = detectLang(cwd);
    if (detected === null) {
      console.error(chalk.red('Error:'), 'No se pudo detectar el lenguaje del proyecto.');
      console.log(chalk.gray('Archivos reconocidos: pom.xml, build.gradle, pyproject.toml, setup.py, requirements.txt, package.json'));
      console.log(chalk.gray('O usa: flowtrace run --lang <java|python|node|ts> -- <cmd>'));
      process.exit(1);
    }
    if (Array.isArray(detected)) {
      // Multi-lang: prompt via inquirer
      const inquirer = require('inquirer');
      const { choice } = await inquirer.prompt([{
        type: 'list',
        name: 'choice',
        message: 'Se detectaron varios lenguajes. Selecciona:',
        choices: detected,
      }]);
      lang = choice;
    } else {
      lang = detected;
      console.log(chalk.gray(`  lang (detectado): ${lang}`));
    }
  }

  if (!SUPPORTED_LANGS.has(lang)) {
    console.error(chalk.red('Error:'), `Lenguaje no soportado: ${lang}`);
    console.log(chalk.gray(`Soportados: ${[...SUPPORTED_LANGS].join(', ')}`));
    process.exit(2);
  }

  // Build output path with ISO-UTC-no-colons filename
  const outDir = path.join(cwd, '.flowtrace');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+Z$/, 'Z');
  const outPath = options.out || path.join(outDir, `${stamp}.jsonl`);

  // Auto-add .flowtrace/ to .gitignore
  ensureGitignore(cwd);

  // ---- Java path ----
  if (lang === 'java') {
    return runJava({ options, restArgs, cwd, outPath });
  }

  // ---- Python path ----
  if (lang === 'python') {
    return runPython({ options, restArgs, cwd, outPath });
  }

  // ---- Node / TypeScript path ----
  if (lang === 'node' || lang === 'ts') {
    return runNode({ options, restArgs, cwd, outPath });
  }

  // ---- Other langs: stub (S3-S4) ----
  console.log(chalk.cyan('FlowTrace v2 run'));
  console.log(chalk.gray(`  lang  : ${lang}`));
  console.log(chalk.gray(`  out   : ${outPath}`));
  console.log(chalk.gray(`  args  : ${restArgs.join(' ') || '(none)'}`));
  console.log(chalk.yellow(`  Soporte de ${lang} disponible en S3-S4.`));
  return { lang, outPath, args: restArgs };
}

/**
 * Read <version> from the extension's pom, so jar paths cannot drift out of sync
 * with the project version the way a hardcoded "2.0.0-SNAPSHOT" did.
 * @param {string} extDir
 * @returns {string}
 */
function detectExtensionVersion(extDir) {
  try {
    const pom = fs.readFileSync(path.join(extDir, 'pom.xml'), 'utf8');
    const m = pom.match(/<version>([^<]+)<\/version>/);
    if (m) return m[1].trim();
  } catch {
    /* fall through */
  }
  return '2.0.0';
}

async function runJava({ options, restArgs, cwd, outPath }) {
  const root = repoRoot();

  // 1. Resolve jar paths
  const extDir = path.join(root, 'capture', 'java', 'flowtrace-otel-extension');

  // Version read from the pom, not hardcoded. This said "2.0.0-SNAPSHOT", which
  // has not existed since the 2.0.0 release — so `flowtrace run --lang java`,
  // the documented entry point, could never find the extension. The same stale
  // glob appeared in the integration test, the benchmark harness and the
  // truncation parity script; deriving it means a version bump cannot repeat it.
  const extVersion = detectExtensionVersion(extDir);
  const flExt = path.join(extDir, 'target', `flowtrace-otel-extension-${extVersion}.jar`);

  // vendor/java/ is fetched separately and holds only a README in a fresh
  // checkout. Maven already downloads the same agent into target/dependency/ as
  // part of `make build-java`, so prefer whichever exists rather than failing on
  // a step the user has no reason to have run.
  const vendored = path.join(root, 'flowtrace-cli', 'vendor', 'java', 'opentelemetry-javaagent.jar');
  const fromMaven = path.join(extDir, 'target', 'dependency', 'opentelemetry-javaagent.jar');
  const otelAgent = fs.existsSync(vendored) ? vendored : fromMaven;

  if (!fs.existsSync(otelAgent)) {
    console.error(chalk.red('Error:'), 'No se encontró el agente OTel de OpenTelemetry.');
    console.log(chalk.gray(`  buscado en: ${vendored}`));
    console.log(chalk.gray(`  y en:       ${fromMaven}`));
    console.log(chalk.gray('Ejecuta: make build-java   (en la raíz del repo)  o  make fetch-deps (en flowtrace-cli/)'));
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
      reportCapture(outPath, 'java', prefix);
      process.exit(code ?? 0);
      resolve();
    });
  });
}

// ---------- Python injection ----------

/**
 * Detect package prefix from pyproject.toml or setup.py in cwd.
 * Returns null if not found.
 */
function detectPythonPrefix(cwd) {
  // Try pyproject.toml [project] name field.
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const src = fs.readFileSync(pyprojectPath, 'utf-8');
    const m = src.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1].trim().replace(/-/g, '_');
  }
  // Try setup.py name= argument.
  const setupPath = path.join(cwd, 'setup.py');
  if (fs.existsSync(setupPath)) {
    const src = fs.readFileSync(setupPath, 'utf-8');
    const m = src.match(/name\s*=\s*["']([^"']+)["']/);
    if (m) return m[1].trim().replace(/-/g, '_');
  }
  return null;
}

/**
 * Build env for Python injection.
 * Prepends BOTH the stub dir (contains sitecustomize.py) AND the parent of
 * flowtrace_runtime/ (capture/python/) so that `import flowtrace_runtime`
 * resolves correctly without a pip install.
 */
function buildPythonEnv({ prefix, outPath, stubDir }) {
  const root = repoRoot();
  // capture/python/ is the directory that contains the flowtrace_runtime/ package.
  const runtimeParent = path.resolve(root, 'capture', 'python');
  const existing = process.env.PYTHONPATH || '';
  const parts = [stubDir, runtimeParent];
  if (existing) parts.push(existing);
  return {
    ...process.env,
    PYTHONPATH: parts.join(path.delimiter),
    FLOWTRACE_ENABLE: '1',
    FLOWTRACE_PACKAGE_PREFIX: prefix,
    FLOWTRACE_OUTPUT: outPath,
  };
}

async function runPython({ options, restArgs, cwd, outPath }) {
  const root = repoRoot();

  // 1. Resolve stub dir (ships with capture/python/stub/).
  const stubDir = path.join(root, 'capture', 'python', 'stub');
  if (!fs.existsSync(stubDir)) {
    console.error(chalk.red('Error:'), `No se encontró el directorio stub de Python: ${stubDir}`);
    console.log(chalk.gray('Asegúrate de que capture/python/stub/sitecustomize.py existe.'));
    process.exit(1);
  }

  // 2. Copy stub to .flowtrace/python-stub/ (project-local).
  const localStub = path.join(cwd, '.flowtrace', 'python-stub');
  if (!fs.existsSync(localStub)) fs.mkdirSync(localStub, { recursive: true });
  const srcSite = path.join(stubDir, 'sitecustomize.py');
  const dstSite = path.join(localStub, 'sitecustomize.py');
  fs.copyFileSync(srcSite, dstSite);

  // 3. Resolve package prefix.
  let prefix = options.packagePrefix || options['package-prefix'];
  if (!prefix) {
    prefix = detectPythonPrefix(cwd);
    if (!prefix) {
      console.error(chalk.red('Error:'), 'No se pudo detectar el package prefix automáticamente.');
      console.log(chalk.gray('Usa: flowtrace run --lang python --package-prefix mipaquete -- python app.py'));
      process.exit(1);
    }
    console.log(chalk.gray(`  prefix (detectado): ${prefix}`));
  }

  // 4. Validate user command.
  if (!restArgs.length) {
    console.error(chalk.red('Error:'), 'Debes proporcionar el comando a ejecutar después de --.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang python -- python app.py'));
    process.exit(1);
  }

  // Python's prefix is a comma-separated list of MODULE names, not a path, and
  // the auto-detected value comes from the project name — which for a
  // single-script project matches no module at all, so the run produced an empty
  // trace while appearing to succeed. Add the script's own module name, since
  // `python app.py` makes app the module under trace. Both are kept: a package
  // project still wants its package prefix.
  const scriptArg = restArgs.find((a) => a.endsWith('.py'));
  if (scriptArg) {
    const scriptModule = path.basename(scriptArg, '.py');
    const known = prefix.split(',').map((x) => x.trim()).filter(Boolean);
    if (!known.includes(scriptModule)) {
      known.push(scriptModule);
      prefix = known.join(',');
      console.log(chalk.gray(`  prefix (+script): ${prefix}`));
    }
  }

  // 5. Build env and spawn.
  const env = buildPythonEnv({ prefix, outPath, stubDir: localStub });
  const [cmd, ...args] = restArgs;

  console.log(chalk.cyan('FlowTrace v2 — Python instrumentado'));
  console.log(chalk.gray(`  prefix  : ${prefix}`));
  console.log(chalk.gray(`  salida  : ${outPath}`));
  console.log(chalk.gray(`  comando : ${restArgs.join(' ')}`));

  const child = spawn(cmd, args, { env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));

  return new Promise((resolve) => {
    child.on('close', (code) => {
      reportCapture(outPath, 'python', prefix);
      process.exit(code ?? 0);
      resolve();
    });
  });
}

// ---------- Node / TypeScript injection ----------

/**
 * Build env for Node/TS injection via --import bootstrap.mjs.
 * @param {object} opts
 * @param {string} opts.bootstrapPath - absolute path to bootstrap.mjs
 * @param {string} opts.prefix        - package prefix
 * @param {string} opts.outPath       - absolute path to output JSONL
 * @returns {object} env
 */
function buildNodeEnv({ bootstrapPath, prefix, outPath }) {
  const existing = process.env.NODE_OPTIONS || '';
  const importFlag = `--import file://${bootstrapPath} --enable-source-maps`;
  const nodeOptions = existing
    ? `${importFlag} ${existing}`
    : importFlag;

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    FLOWTRACE_OUTPUT: outPath,
    FLOWTRACE_PACKAGE_PREFIX: prefix,
  };
}

async function runNode({ options, restArgs, cwd, outPath }) {
  const root = repoRoot();

  // 1. Resolve bootstrap path
  const bootstrapPath = path.join(root, 'capture', 'node', 'src', 'bootstrap.mjs');
  if (!fs.existsSync(bootstrapPath)) {
    console.error(chalk.red('Error:'), `No se encontró el bootstrap de Node: ${bootstrapPath}`);
    console.log(chalk.gray('Asegúrate de que capture/node/src/bootstrap.mjs existe.'));
    process.exit(1);
  }

  // 2. Detect package prefix
  let prefix = options.packagePrefix || options['package-prefix'];
  if (!prefix) {
    // Default: relative cwd path (instruments all project files)
    prefix = cwd;
    console.log(chalk.gray(`  prefix (cwd): ${prefix}`));
  }

  // 3. Validate user command
  if (!restArgs.length) {
    console.error(chalk.red('Error:'), 'Debes proporcionar el comando a ejecutar después de --.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang node -- node app.js'));
    process.exit(1);
  }

  // 4. Build env and spawn (env vars only — do NOT splice into argv)
  const env = buildNodeEnv({ bootstrapPath, prefix, outPath });
  const [cmd, ...args] = restArgs;

  console.log(chalk.cyan('FlowTrace v2 — Node instrumentado'));
  console.log(chalk.gray(`  bootstrap : ${bootstrapPath}`));
  console.log(chalk.gray(`  prefix    : ${prefix}`));
  console.log(chalk.gray(`  salida    : ${outPath}`));
  console.log(chalk.gray(`  comando   : ${restArgs.join(' ')}`));

  const child = spawn(cmd, args, { env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));

  return new Promise((resolve) => {
    child.on('close', (code) => {
      reportCapture(outPath, 'node', prefix);
      process.exit(code ?? 0);
      resolve();
    });
  });
}


/**
 * Report, after the traced process exits, whether anything was actually captured.
 *
 * Every failure mode in this tool that is not a crash looks identical from the
 * outside: the program runs, prints its own output, exits 0 — and the trace is
 * empty. It happened for real in all three languages: a Python prefix derived
 * from the project name instead of the module name matched nothing, a Java run
 * silently lacked the agent, a Node run had its own source in scope. In each case
 * the user is told the run "succeeded".
 *
 * So the count is checked and an empty result is called out with the specific
 * thing to look at, per language. This is the single most useful diagnostic in the
 * CLI: it converts an invisible failure into an actionable one regardless of cause.
 *
 * @param {string} outPath
 * @param {'java'|'python'|'node'|'ts'} lang
 * @param {string} prefix
 */
function reportCapture(outPath, lang, prefix) {
  let events = 0;
  try {
    if (fs.existsSync(outPath)) {
      events = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim()).length;
    }
  } catch {
    /* unreadable output is reported as zero below */
  }

  if (events > 0) {
    console.log(chalk.green(`  capturado : ${events} eventos -> ${outPath}`));
    return;
  }

  console.error(chalk.yellow('\nAdvertencia:'), 'el programa se ejecutó pero NO se capturó ningún evento.');
  console.error(chalk.gray(`  salida esperada: ${outPath}`));
  if (lang === 'python') {
    console.error(chalk.gray(`  El prefijo de Python es una lista de MÓDULOS separados por coma, no una ruta.`));
    console.error(chalk.gray(`  Actual: "${prefix}". Para un script suelto suele ser el nombre del archivo sin .py.`));
    console.error(chalk.gray(`  Prueba: flowtrace run --lang python --package-prefix <modulo> -- python app.py`));
  } else if (lang === 'java') {
    console.error(chalk.gray(`  Verifica que --package-prefix ("${prefix}") coincida con el paquete de tus clases.`));
  } else {
    console.error(chalk.gray(`  Verifica que el código esté bajo el prefijo ("${prefix}") y fuera de node_modules.`));
  }
}

// Export internals for testing
runCommand._buildJavaInjection = buildJavaInjection;
runCommand._buildNodeEnv = buildNodeEnv;
runCommand._detectGroupIdFromPom = detectGroupIdFromPom;
runCommand._ensureGitignore = ensureGitignore;
runCommand._detectPythonPrefix = detectPythonPrefix;
runCommand._buildPythonEnv = buildPythonEnv;
runCommand._reportCapture = reportCapture;
runCommand._detectExtensionVersion = detectExtensionVersion;

module.exports = runCommand;
