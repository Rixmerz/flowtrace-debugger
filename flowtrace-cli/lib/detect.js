/**
 * Language auto-detection for flowtrace-cli.
 * detectLang(cwd)          -> 'java'|'python'|'node'|'ts'|null|string[]
 * detectPackagePrefix(cwd, lang) -> string|null
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { detectPythonPrefix } = require('./python-prefix');
const { detectGoModulePath } = require('./go-module');

/**
 * Returns 'java'|'python'|'node'|'ts'|'go'|null
 * or string[] if multiple languages are detected.
 */
function detectLang(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const detected = [];

  // Java: pom.xml OR build.gradle / build.gradle.kts
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) {
    detected.push('java');
  }

  // Python: pyproject.toml OR setup.py OR requirements.txt
  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    detected.push('python');
  }

  // Node / TS: package.json (ts if tsconfig.json also present)
  if (has('package.json')) {
    detected.push(has('tsconfig.json') ? 'ts' : 'node');
  }

  // Go: go.mod
  if (has('go.mod')) {
    detected.push('go');
  }

  if (detected.length === 0) return null;
  if (detected.length === 1) return detected[0];
  return detected; // multi-lang — caller prompts
}

/**
 * The language a command is going to run, from the program it names, or null
 * when the command says nothing about it.
 *
 * This exists because detectLang only looks at the files in cwd, and a cwd can
 * sit above more than one project. Run from the root of a worktree holding a
 * Python service and a `node/` subdirectory, detection saw requirements.txt,
 * answered "python", and `flowtrace run -- node src/app.js` then launched a
 * Node process with PYTHONPATH and a Python package prefix pointing at it.
 * Nothing failed: the Node program ran, untouched, and produced an empty
 * trace — which reads as "my code never ran" rather than "the wrong capture
 * layer was wired up". The command is far stronger evidence of what is about
 * to run than a file in the current directory, so it gets to correct it.
 *
 * Deliberately conservative. Only launchers that can run exactly one language
 * are listed: `npm`, `pnpm`, `yarn` and `npx` are NOT, because `npm test` in a
 * polyglot repo routinely shells out to pytest or maven, and a wrong
 * correction is worse than none. An unrecognised command returns null and
 * detection is left alone.
 *
 * node and ts are one answer, not two: `node app.ts` and `ts-node app.ts` are
 * the same capture layer, and which of the two a project is called depends on
 * whether a tsconfig.json happens to sit next to the package.json.
 *
 * @param {string[]} argv - The tokens after `--`.
 * @returns {'java'|'python'|'node'|'go'|null}
 */
function langFromCommand(argv) {
  const first = argv?.[0];
  if (!first) return null;
  // Strip any directory and, on Windows, the extension: a command can arrive
  // as `python`, `/usr/bin/python3.12`, `./venv/bin/python` or `node.exe`.
  const bin = path.basename(String(first)).replace(/\.(exe|cmd|bat)$/i, '');

  if (/^python[\d.]*$/.test(bin) || bin === 'pytest' || bin === 'uvicorn' || bin === 'gunicorn') {
    return 'python';
  }
  if (bin === 'node' || bin === 'nodejs' || bin === 'ts-node' || bin === 'tsx') return 'node';
  if (bin === 'java' || bin === 'mvn' || bin === 'mvnw' || bin === 'gradle' || bin === 'gradlew') {
    return 'java';
  }
  if (bin === 'go') return 'go';
  return null;
}

/** node and ts are the same capture layer; everything else stands alone. */
function sameCaptureLayer(a, b) {
  if (a === b) return true;
  const nodeish = (l) => l === 'node' || l === 'ts';
  return nodeish(a) && nodeish(b);
}

/**
 * Returns detected package prefix string or null.
 */
function detectPackagePrefix(cwd, lang) {
  if (lang === 'java') return _javaPrefix(cwd);
  if (lang === 'python') return _pythonPrefix(cwd);
  if (lang === 'node' || lang === 'ts') return _nodePrefix(cwd);
  if (lang === 'go') return detectGoModulePath(cwd);
  return null;
}

// ---- Java ----
function _javaPrefix(cwd) {
  // pom.xml groupId
  const pomPath = path.join(cwd, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const src = fs.readFileSync(pomPath, 'utf-8');
    const m = src.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/);
    if (m) return m[1].trim();
  }
  // build.gradle  group = "..."  or  group = '...'
  for (const gf of ['build.gradle', 'build.gradle.kts']) {
    const gp = path.join(cwd, gf);
    if (fs.existsSync(gp)) {
      const src = fs.readFileSync(gp, 'utf-8');
      const m = src.match(/^\s*group\s*=\s*["']([^"']+)["']/m);
      if (m) return m[1].trim();
    }
  }
  return null;
}

// ---- Python ----
function _pythonPrefix(cwd) {
  return detectPythonPrefix(cwd);
}

// ---- Node / TS ----
/**
 * For Node the capture layer matches FLOWTRACE_PACKAGE_PREFIX as a **path
 * substring**: `capture/node/src/cjs/hook.js` does `filename.includes(prefix)`,
 * and the ESM loader the same. So the value that works is a directory, not a
 * package name.
 *
 * This used to return the package.json `name` with the npm scope stripped
 * (`@acme/api-server` -> `api-server`), which instruments the project only
 * when the directory happens to be named after the package. When it is not —
 * a monorepo where `packages/core` publishes as `@acme/core-runtime`, a clone
 * into `myproject-main` — nothing matched and the trace came out EMPTY, which
 * reads as "my code never ran" rather than "the prefix is wrong". `flowtrace
 * run` always used the directory, so `init` and `run` disagreed on the same
 * project.
 *
 * The package name is still what identifies the project to a human, so it is
 * recorded alongside as `capture.packageName` by `flowtrace init`.
 */
function _nodePrefix(cwd) {
  if (!fs.existsSync(path.join(cwd, 'package.json'))) return null;
  return cwd;
}

/** The npm package name (scope stripped), for display. Not a capture prefix. */
function nodePackageName(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!pkg.name) return null;
    return pkg.name.replace(/^@[^/]+\//, '');
  } catch {
    return null;
  }
}

module.exports = { detectLang, detectPackagePrefix, nodePackageName, langFromCommand, sameCaptureLayer };
