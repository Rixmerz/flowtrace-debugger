/**
 * `flowtrace run` — Java injection via OpenTelemetry agent + FlowTrace extension.
 * Python / Node / TS paths reserved for S3-S4.
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const chalk = require('chalk');
const assets = require('../assets');
const { detectLang, detectPackagePrefix } = require('../detect');
const { detectPythonPrefix } = require('../python-prefix');
const { detectGoModulePath } = require('../go-module');
const { ensureGitignore } = require('../gitignore');

const SUPPORTED_LANGS = new Set(['java', 'python', 'node', 'ts', 'go']);

/** `go run`/`go build`/`go test` are the only subcommands flowtrace-go can
 * splice `-overlay` into — see capture/go/cmd/flowtrace-go's own
 * validSubcommands for the second line of defense. */
const GO_SUBCOMMANDS = new Set(['run', 'build', 'test']);

// ---------- helpers ----------

/**
 * How a child process that died from a signal should be reported.
 *
 * `process.exit(code ?? 0)` reported SUCCESS for a program the OOM killer took
 * out, a segfault, or any SIGKILL: Node sets `code` to null and `signal` to the
 * name in that case. A wrapper that turns a crash into exit 0 is worse than no
 * wrapper — CI goes green on a crashed run. 128+n is the shell convention.
 */
function exitStatusFor(code, signal) {
  if (signal) {
    const n = os.constants.signals[signal];
    return typeof n === 'number' ? 128 + n : 1;
  }
  return code ?? 0;
}

/** Waits for the child and exits with the status the shell would report. */
function exitWithChild(child) {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => {
      if (signal) {
        console.error(chalk.yellow('Aviso:'), `el proceso terminó por señal ${signal}.`);
      }
      process.exit(exitStatusFor(code, signal));
      resolve();
    });
  });
}

/**
 * A JVM flag as it must appear inside MAVEN_OPTS / JAVA_TOOL_OPTIONS.
 *
 * Both variables are split on whitespace by the JVM launcher, so a path with a
 * space — routine on macOS and Windows — turned one flag into two broken ones
 * and the agent never loaded. Both accept double quotes around the value.
 */
function quoteJvmFlag(flag) {
  if (!/\s/.test(flag)) return flag;
  // Quote the VALUE, not the whole flag: `-javaagent:"/My Files/a.jar"` is
  // what the JVM's own option parser expects, and quoting the flag name along
  // with it is accepted in fewer launchers.
  const sep = /^-(?:javaagent|agentpath|agentlib):/.test(flag)
    ? flag.indexOf(':')
    : flag.indexOf('=');
  if (sep === -1) return `"${flag}"`;
  return `${flag.slice(0, sep + 1)}"${flag.slice(sep + 1)}"`;
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
function buildJavaInjection({ otelAgent, flExt, prefix, outPath, strategy, userArgs, captureKnobs = {} }) {
  const jvmFlags = [
    `-javaagent:${otelAgent}`,
    `-Dotel.javaagent.extensions=${flExt}`,
    `-Dotel.traces.exporter=none`,
    `-Dotel.metrics.exporter=none`,
    `-Dotel.logs.exporter=none`,
    `-Dflowtrace.package-prefix=${prefix}`,
    `-Dflowtrace.output=${outPath}`,
  ];
  // The Java layer reads system properties first and the env vars as a
  // fallback; setting the property keeps `mvn`/`gradle` launchers working too.
  if (captureKnobs.FLOWTRACE_MAX_ARG_LENGTH !== undefined) {
    jvmFlags.push(`-Dflowtrace.max-arg-length=${captureKnobs.FLOWTRACE_MAX_ARG_LENGTH}`);
  }
  if (captureKnobs.FLOWTRACE_REDACT_KEYS !== undefined) {
    jvmFlags.push(`-Dflowtrace.redact-keys=${captureKnobs.FLOWTRACE_REDACT_KEYS}`);
  }

  const env = { ...process.env, ...captureKnobs };
  const [first, ...rest] = userArgs;
  const optsFlags = jvmFlags.map(quoteJvmFlag).join(' ');

  // Explicit strategy overrides
  if (strategy === 'mvn') {
    const existing = env.MAVEN_OPTS || '';
    env.MAVEN_OPTS = (existing + ' ' + optsFlags).trim();
    return { cmd: first, args: rest, env };
  }
  if (strategy === 'gradle') {
    const existing = env.JAVA_TOOL_OPTIONS || '';
    env.JAVA_TOOL_OPTIONS = (existing + ' ' + optsFlags).trim();
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
    env.MAVEN_OPTS = (existing + ' ' + optsFlags).trim();
    return { cmd: first, args: rest, env };
  }
  if (bin === 'gradle' || bin === 'gradlew') {
    const existing = env.JAVA_TOOL_OPTIONS || '';
    env.JAVA_TOOL_OPTIONS = (existing + ' ' + optsFlags).trim();
    return { cmd: first, args: rest, env };
  }

  // Generic fallback: JAVA_TOOL_OPTIONS works for any JVM launcher
  const existing = env.JAVA_TOOL_OPTIONS || '';
  env.JAVA_TOOL_OPTIONS = (existing + ' ' + optsFlags).trim();
  return { cmd: first, args: rest, env };
}

/**
 * The package prefix to instrument with, in precedence order:
 * `--package-prefix` > `.flowtrace/config.json` > auto-detection.
 *
 * The config file was written by `flowtrace init` and then ignored by every
 * run: only `config.lang` was ever read, so the prefix a user reviewed and
 * edited had no effect at all, and neither did `capture.maxArgLength`.
 */
function resolvePrefix({ options, config, cwd, lang }) {
  const explicit = options.packagePrefix || options['package-prefix'];
  if (explicit) return explicit;
  const fromConfig = config?.capture?.packagePrefix;
  if (fromConfig) {
    console.log(chalk.gray(`  prefix (config): ${fromConfig}`));
    return fromConfig;
  }
  const detected = detectPackagePrefix(cwd, lang);
  if (detected) console.log(chalk.gray(`  prefix (detectado): ${detected}`));
  return detected;
}

/**
 * Capture knobs from `.flowtrace/config.json`, as environment for every
 * runtime. `maxArgLength: 0` is meaningful (no truncation) so it is passed
 * through rather than treated as absent.
 */
function captureEnv(config) {
  const env = {};
  const max = config?.capture?.maxArgLength;
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0) {
    env.FLOWTRACE_MAX_ARG_LENGTH = String(Math.floor(max));
  }
  const redact = config?.capture?.redactKeys;
  if (Array.isArray(redact) && redact.length) env.FLOWTRACE_REDACT_KEYS = redact.join(',');
  else if (typeof redact === 'string' && redact.trim()) env.FLOWTRACE_REDACT_KEYS = redact.trim();
  return env;
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
      console.log(chalk.gray('Archivos reconocidos: pom.xml, build.gradle, pyproject.toml, setup.py, requirements.txt, package.json, go.mod'));
      console.log(chalk.gray('O usa: flowtrace run --lang <java|python|node|ts|go> -- <cmd>'));
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
    return runJava({ options, restArgs, cwd, outPath, config });
  }

  // ---- Python path ----
  if (lang === 'python') {
    return runPython({ options, restArgs, cwd, outPath, config });
  }

  // ---- Node / TypeScript path ----
  if (lang === 'node' || lang === 'ts') {
    return runNode({ options, restArgs, cwd, outPath, config });
  }

  // ---- Go path ----
  if (lang === 'go') {
    return runGo({ options, restArgs, cwd, outPath, config });
  }

  // ---- Other langs: stub (S3-S4) ----
  console.log(chalk.cyan('FlowTrace v2 run'));
  console.log(chalk.gray(`  lang  : ${lang}`));
  console.log(chalk.gray(`  out   : ${outPath}`));
  console.log(chalk.gray(`  args  : ${restArgs.join(' ') || '(none)'}`));
  console.log(chalk.yellow(`  Soporte de ${lang} disponible en S3-S4.`));
  return { lang, outPath, args: restArgs };
}

async function runJava({ options, restArgs, cwd, outPath, config = {} }) {
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
  // detectPackagePrefix reads pom.xml AND build.gradle(.kts); the local
  // pom-only copy that used to live here meant `flowtrace init` found a Gradle
  // project's prefix and `flowtrace run` then refused to start.
  let prefix = resolvePrefix({ options, config, cwd, lang: 'java' });
  if (!prefix) {
    console.error(chalk.red('Error:'), 'No se pudo detectar el package prefix automáticamente.');
    console.log(chalk.gray('Usa: flowtrace run --lang java --package-prefix com.miempresa -- java -jar app.jar'));
    process.exit(1);
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
    captureKnobs: captureEnv(config),
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

  return exitWithChild(child);
}

// ---------- Python injection ----------

/**
 * Build env for Python injection.
 * Prepends BOTH the stub dir (contains sitecustomize.py) AND the parent of
 * flowtrace_runtime/ (capture/python/) so that `import flowtrace_runtime`
 * resolves correctly without a pip install.
 */
function buildPythonEnv({ prefix, outPath, stubDir, captureKnobs = {} }) {
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
    ...captureKnobs,
  };
}

async function runPython({ options, restArgs, cwd, outPath, config = {} }) {
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
  let prefix = resolvePrefix({ options, config, cwd, lang: 'python' });
  if (!prefix) {
    console.error(chalk.red('Error:'), 'No se pudo detectar el package prefix automáticamente.');
    console.log(chalk.gray('Usa: flowtrace run --lang python --package-prefix mipaquete -- python app.py'));
    process.exit(1);
  }

  // 4. Validate user command.
  if (!restArgs.length) {
    console.error(chalk.red('Error:'), 'Debes proporcionar el comando a ejecutar después de --.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang python -- python app.py'));
    process.exit(1);
  }

  // 5. Build env and spawn.
  const env = buildPythonEnv({ prefix, outPath, stubDir: localStub, captureKnobs: captureEnv(config) });
  const [cmd, ...args] = restArgs;

  console.log(chalk.cyan('FlowTrace v2 — Python instrumentado'));
  console.log(chalk.gray(`  prefix  : ${prefix}`));
  console.log(chalk.gray(`  salida  : ${outPath}`));
  console.log(chalk.gray(`  comando : ${restArgs.join(' ')}`));

  const child = spawn(cmd, args, { env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));

  return new Promise((resolve) => {
    child.on('close', async (code, signal) => {
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
      if (signal) {
        console.error(chalk.yellow('Aviso:'), `el proceso terminó por señal ${signal}.`);
      }
      process.exit(exitStatusFor(code, signal));
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
function buildNodeEnv({ bootstrapPath, prefix, outPath, captureKnobs = {} }) {
  const existing = process.env.NODE_OPTIONS || '';
  // pathToFileURL, not `file://${path}`: NODE_OPTIONS is split on whitespace,
  // so an install under "My Projects" produced two broken half-flags and the
  // loader silently never registered — an empty trace, the failure mode this
  // tool most needs not to have.
  const importFlag = `--import ${pathToFileURL(bootstrapPath).href} --enable-source-maps`;
  const nodeOptions = existing
    ? `${importFlag} ${existing}`
    : importFlag;

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    FLOWTRACE_OUTPUT: outPath,
    FLOWTRACE_PACKAGE_PREFIX: prefix,
    ...captureKnobs,
  };
}

/**
 * Minimum Node for the Node/TS capture layer: module.register() landed in
 * 20.6. The CLI's own `engines` floor is 18 deliberately — it runs fine there
 * to trace Java, Python and Go — so nothing stops a Node 18 user installing it
 * and reaching this path, where the ESM loader would simply never register and
 * the trace would come out empty. An empty trace is the single most misleading
 * failure this tool has: it reads as "my code never ran". Refuse up front with
 * the version, the same way the Go driver refuses below its floor.
 *
 * Node 26 runtime-deprecates module.register() as DEP0205 and points at
 * module.registerHooks(), so a traced Node program prints a DeprecationWarning
 * on every run there. That migration is deliberately NOT done yet, and the
 * trigger for doing it is this floor reaching 22.15 — not the warning
 * appearing. registerHooks landed in 22.15 and takes SYNCHRONOUS hooks, while
 * capture/node/src/esm/loader.mjs is async by necessity (it awaits nextLoad).
 * Supporting both therefore means two hook shapes, and the register() half —
 * the path every user from 20.6 to 22.14 takes — cannot be exercised on a Node
 * that has registerHooks. Shipping the more travelled path tested only through
 * a feature flag, to remove a cosmetic warning from a still-working API, is a
 * bad trade; that file's own comments record four separate silent failures
 * (exit 0, no output, no events) earned by changing it.
 *
 * When the floor does move: keep ONE implementation. Extract the part after
 * nextLoad — which is already fully synchronous, transform() and the cache
 * helpers included — into a shared function, and let an async and a sync hook
 * both call it. Two copies of that logic would rot apart.
 */
const NODE_CAPTURE_MIN = [20, 6];

function nodeTooOld() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  const [reqMaj, reqMin] = NODE_CAPTURE_MIN;
  return maj < reqMaj || (maj === reqMaj && min < reqMin);
}

async function runNode({ options, restArgs, cwd, outPath, config = {} }) {
  // 0. Refuse before doing anything if this Node cannot be instrumented.
  if (nodeTooOld()) {
    console.error(
      chalk.red('Error:'),
      `la captura de Node requiere Node ${NODE_CAPTURE_MIN.join('.')}+ y estás en ${process.versions.node}.`
    );
    console.log(chalk.gray('  El loader ESM se registra con module.register(), disponible desde 20.6.'));
    console.log(chalk.gray('  En una versión anterior la traza saldría vacía en vez de fallar.'));
    console.log(chalk.gray('  Java, Python y Go sí funcionan en esta versión de Node.'));
    process.exit(1);
  }

  // 1. Resolve bootstrap path
  const bootstrapPath = assets.nodeBootstrap();
  if (!fs.existsSync(bootstrapPath)) {
    console.error(chalk.red('Error:'), `No se encontró el bootstrap de Node: ${bootstrapPath}`);
    console.log(chalk.gray('Asegúrate de que capture/node/src/bootstrap.mjs existe.'));
    process.exit(1);
  }

  // 2. Detect package prefix
  // For Node the capture layer matches the prefix as a PATH SUBSTRING
  // (capture/node/src/cjs/hook.js: `filename.includes(prefix)`), so the
  // project directory is what it wants — not a package name. detect.js now
  // returns the same thing, so `init` and `run` agree.
  let prefix = resolvePrefix({ options, config, cwd, lang: 'node' });
  if (!prefix) {
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
  const env = buildNodeEnv({ bootstrapPath, prefix, outPath, captureKnobs: captureEnv(config) });
  const [cmd, ...args] = restArgs;

  console.log(chalk.cyan('FlowTrace v2 — Node instrumentado'));
  console.log(chalk.gray(`  bootstrap : ${bootstrapPath}`));
  console.log(chalk.gray(`  prefix    : ${prefix}`));
  console.log(chalk.gray(`  salida    : ${outPath}`));
  console.log(chalk.gray(`  comando   : ${restArgs.join(' ')}`));

  const child = spawn(cmd, args, { env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));

  return exitWithChild(child);
}

// ---------- Go injection ----------

/**
 * Build the `go run <driver>` invocation that launches flowtrace-go.
 *
 * flowtrace-go always runs from source via `go run` — like the Python path,
 * there is no separate build step. The subtlety `go run` forces on us: it
 * resolves the *main module* from its OWN working directory, not from the
 * package path it is given, so this has to spawn with cwd = captureGoDir
 * (flowtrace-go's own module, capture/go) and hand the target module's
 * directory to the driver explicitly via its own -dir flag, rather than
 * just letting it inherit cwd — see capture/go/cmd/flowtrace-go's -dir flag
 * doc comment for the same story from the other side.
 */
function buildGoInvocation({ captureGoDir, moduleDir, goSubcommand, goRest, outPath, prefix, captureKnobs = {} }) {
  const driverDir = path.join(captureGoDir, 'cmd', 'flowtrace-go');
  const runtimeSrc = path.join(captureGoDir, 'flowtracert');
  const args = [
    'run', driverDir,
    '-runtime-src', runtimeSrc,
    '-dir', moduleDir,
    goSubcommand, ...goRest,
  ];
  // The Go driver selects packages by import-path prefix. Passing the module
  // path is a no-op (it selects the whole main module, the old behaviour);
  // --package-prefix narrows it to one subtree.
  const env = { ...process.env, FLOWTRACE_OUTPUT: outPath, ...captureKnobs };
  if (prefix) env.FLOWTRACE_PACKAGE_PREFIX = prefix;
  return { cmd: 'go', args, cwd: captureGoDir, env };
}

async function runGo({ options, restArgs, cwd, outPath, config = {} }) {
  // 1. Resolve capture/go (checkout preferred over vendored, per assets.js).
  const captureGoDir = assets.goCaptureDir();
  if (!captureGoDir) {
    console.error(chalk.red('Error:'), 'No se encontró capture/go.');
    console.log(chalk.gray(assets.isVendored()
      ? 'La instalación parece incompleta — reinstala el paquete.'
      : 'Asegúrate de que capture/go existe en el checkout.'));
    process.exit(1);
  }

  // 2. Validate the user command.
  if (!restArgs.length) {
    console.error(chalk.red('Error:'), 'Debes proporcionar el comando a ejecutar después de --.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang go -- go run ./cmd/api'));
    process.exit(1);
  }
  // Go has no runtime hook to instrument — a prebuilt binary has nothing
  // left to splice into by the time it reaches here, so that has to be an
  // explicit, actionable error rather than a silent empty trace (AC1).
  if (restArgs[0] !== 'go' || !GO_SUBCOMMANDS.has(restArgs[1])) {
    console.error(chalk.red('Error:'), 'flowtrace instrumenta `go run`, `go build` o `go test` — no un binario ya compilado.');
    console.log(chalk.gray('Ejemplo: flowtrace run --lang go -- go run ./cmd/api'));
    process.exit(1);
  }

  // 3. Module path — informational only here. flowtrace-go re-derives it
  //    itself via `go list -json`, which is also where it gets the
  //    module's root *directory*, not just its import path.
  const modulePath = detectGoModulePath(cwd);
  if (modulePath) console.log(chalk.gray(`  módulo  : ${modulePath}`));
  const prefix = resolvePrefix({ options, config, cwd, lang: 'go' });

  const goSubcommand = restArgs[1];
  const goRest = restArgs.slice(2);
  const { cmd, args, cwd: spawnCwd, env } = buildGoInvocation({
    captureGoDir, moduleDir: cwd, goSubcommand, goRest, outPath,
    prefix, captureKnobs: captureEnv(config),
  });

  console.log(chalk.cyan('FlowTrace v2 — Go instrumentado'));
  console.log(chalk.gray(`  salida  : ${outPath}`));
  console.log(chalk.gray(`  comando : ${restArgs.join(' ')}`));

  const child = spawn(cmd, args, { cwd: spawnCwd, env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));

  return exitWithChild(child);
}

// Export internals for testing
runCommand._buildJavaInjection = buildJavaInjection;
runCommand._buildNodeEnv = buildNodeEnv;
runCommand._ensureGitignore = ensureGitignore;
runCommand._exitStatusFor = exitStatusFor;
runCommand._quoteJvmFlag = quoteJvmFlag;
runCommand._resolvePrefix = resolvePrefix;
runCommand._captureEnv = captureEnv;
runCommand._detectPythonPrefix = detectPythonPrefix;
runCommand._buildPythonEnv = buildPythonEnv;
runCommand._countJsonlLines = _countJsonlLines;
runCommand._buildGoInvocation = buildGoInvocation;
runCommand._detectGoModulePath = detectGoModulePath;

module.exports = runCommand;
