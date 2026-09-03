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

module.exports = { detectLang, detectPackagePrefix, nodePackageName };
