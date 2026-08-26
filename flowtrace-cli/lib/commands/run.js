/**
 * `flowtrace run` — Java injection via OpenTelemetry agent + FlowTrace extension.
 * Python / Node / TS paths reserved for S3-S4.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');
const chalk = require('chalk');
const assets = require('../assets');
const { detectLang, detectPackagePrefix } = require('../detect');
const { detectPythonPrefix } = require('../python-prefix');

const SUPPORTED_LANGS = new Set(['java', 'python', 'node', 'ts']);

// ---------- helpers ----------

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

async function runJava({ options, restArgs, cwd, outPath }) {
  // 1. Resolve jar paths through the asset resolver, which works both from an
  //    npm install and from a checkout. The extension jar is found by prefix,
  //    never by a name carrying the version — that name had gone stale two
  //    releases back and pointed at a SNAPSHOT that no longer exists.
  const flExt = assets.javaExtensionJar();
  if (!flExt) {
    console.error(chalk.red('Error:'), 'No se encontró la extensión FlowTrace para Java.');
    console.log(chalk.gray(assets.isVendored()
      ? 'La instalación parece incompleta — reinstala el paquete.'
      : 'Ejecuta: make build-java'));
    process.exit(1);
  }

  // The OTel agent is not shipped inside the package (~24 MB, and not ours):
  // it is fetched once and cached in ~/.flowtrace/.
  let otelAgent;
  try {
    otelAgent = await assets.ensureOtelAgent((m) => console.log(chalk.gray(m)));
  } catch (e) {
    console.error(chalk.red('Error:'), `No se pudo obtener el agente OpenTelemetry: ${e.message}`);
    console.log(chalk.gray(`Descárgalo manualmente a ${assets.otelAgentPath()} desde:`));
    console.log(chalk.gray(`  ${assets.OTEL_URL}`));
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

// ---------- Python injection ----------

/**
 * Build env for Python injection.
 * Prepends BOTH the stub dir (contains sitecustomize.py) AND the parent of
 * flowtrace_runtime/ (capture/python/) so that `import flowtrace_runtime`
 * resolves correctly without a pip install.
 */
function buildPythonEnv({ prefix, outPath, stubDir }) {
  // The directory that contains the flowtrace_runtime/ package.
  const runtimeParent = assets.pythonRuntimeParent();
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
  // 1. Resolve stub dir (vendored, or capture/python/stub/ in a checkout).
  const stubDir = assets.pythonStubDir();
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
    child.on('close', async (code) => {
      // A wrong package prefix used to fail silently: exit 0, an output path
      // printed, and no file ever written — indistinguishable from "nothing
      // to trace". Warn loudly whenever a Python run traced zero events.
      // The count itself is a best-effort diagnostic: a stat/read error here
      // (e.g. permissions) must never mask the traced program's real exit code.
      try {
        const eventCount = await _countJsonlLines(outPath);
        if (eventCount === 0) {
          console.error(chalk.yellow('Warning:'), `0 eventos capturados en ${outPath}.`);
          console.log(chalk.gray('  ¿El package prefix coincide con el nombre de import real (no el de distribución)?'));
          console.log(chalk.gray(`  prefix usado: ${prefix}`));
        }
      } catch (err) {
        console.error(chalk.yellow('Warning:'), `no se pudo verificar ${outPath}: ${err.message}`);
      }
      process.exit(code ?? 0);
      resolve();
    });
  });
}

/**
 * Number of non-empty lines in a JSONL file, or 0 if it doesn't exist.
 * Streams the file line-by-line rather than reading it whole — traced
 * output routinely exceeds Node's string length limit (ERR_STRING_TOO_LONG).
 */
function _countJsonlLines(filePath) {
  if (!fs.existsSync(filePath)) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    let count = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      if (line.trim()) count += 1;
    });
    rl.on('close', () => resolve(count));
    rl.on('error', reject);
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
  // 1. Resolve bootstrap path
  const bootstrapPath = assets.nodeBootstrap();
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
      process.exit(code ?? 0);
      resolve();
    });
  });
}

// Export internals for testing
runCommand._buildJavaInjection = buildJavaInjection;
runCommand._buildNodeEnv = buildNodeEnv;
runCommand._detectGroupIdFromPom = detectGroupIdFromPom;
runCommand._ensureGitignore = ensureGitignore;
runCommand._detectPythonPrefix = detectPythonPrefix;
runCommand._buildPythonEnv = buildPythonEnv;
runCommand._countJsonlLines = _countJsonlLines;

module.exports = runCommand;
