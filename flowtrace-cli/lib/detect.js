/**
 * Language auto-detection for flowtrace-cli.
 * detectLang(cwd)          -> 'java'|'python'|'node'|'ts'|null|string[]
 * detectPackagePrefix(cwd, lang) -> string|null
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { detectPythonPrefix } = require('./python-prefix');

/**
 * Returns 'java'|'python'|'node'|'ts'|null
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
function _nodePrefix(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!pkg.name) return null;
    // Strip npm scope @org/
    return pkg.name.replace(/^@[^/]+\//, '');
  } catch {
    return null;
  }
}

module.exports = { detectLang, detectPackagePrefix };
