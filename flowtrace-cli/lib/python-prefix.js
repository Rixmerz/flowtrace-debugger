/**
 * Python import-prefix detection, shared by `flowtrace run` (lib/commands/run.js)
 * and `flowtrace init` (lib/detect.js). Previously duplicated between the two —
 * only run.js's copy got fixed to look past the distribution name, leaving
 * init.js on the stale, distribution-name-only implementation. One
 * implementation now, imported by both call sites.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Extract a TOML string array (e.g. `packages = ["a", "b"]`) that appears
 * under a given `[section]` header. Regex-based (like the rest of this
 * file's TOML reading) rather than a full parser — good enough for the
 * flat arrays build backends put here.
 */
function _tomlArrayInSection(src, sectionHeader, key) {
  const sectionRe = new RegExp(
    `\\[${sectionHeader.replace(/[.[\]]/g, '\\$&')}\\]([\\s\\S]*?)(?:\\n\\[|$)`
  );
  const sectionMatch = src.match(sectionRe);
  if (!sectionMatch) return null;
  const body = sectionMatch[1];
  const arrRe = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
  const arrMatch = body.match(arrRe);
  if (!arrMatch) return null;
  const items = arrMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return items.length ? items : null;
}

/**
 * A single top-level directory under `baseDir` containing `__init__.py`.
 * Returns its name, or null if there isn't exactly one.
 */
function _singlePackageDir(baseDir, excludeNames) {
  if (!fs.existsSync(baseDir)) return null;
  const candidates = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => !d.name.startsWith('.'))
    .filter(d => !excludeNames.has(d.name))
    .filter(d => fs.existsSync(path.join(baseDir, d.name, '__init__.py')))
    .map(d => d.name);
  return candidates.length === 1 ? candidates[0] : null;
}

const _NON_PACKAGE_DIRS = new Set([
  'tests', 'test', 'venv', '.venv', 'build', 'dist', '__pycache__', 'docs', 'node_modules',
]);

/**
 * Detect the Python *import* name — which frequently differs from the PyPI
 * distribution name in pyproject.toml/setup.py `name=` (e.g. `pyyaml`→`yaml`,
 * or a distro name with hyphens whose package lives under `src/`).
 * Checked in order, before falling back to the distribution-name guess:
 *   (a) [tool.hatch.build.targets.wheel].packages /
 *       [tool.setuptools.packages.find].where+include in pyproject.toml
 *   (b) a single top-level directory under src/ containing __init__.py
 *   (c) a single top-level directory next to pyproject.toml containing __init__.py
 * Returns null if nothing is found.
 */
function detectPythonPrefix(cwd) {
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  let pyprojectSrc = null;
  if (fs.existsSync(pyprojectPath)) {
    pyprojectSrc = fs.readFileSync(pyprojectPath, 'utf-8');

    // (a) explicit build-backend package declarations.
    const hatchPackages = _tomlArrayInSection(
      pyprojectSrc, 'tool.hatch.build.targets.wheel', 'packages'
    );
    if (hatchPackages) {
      const first = hatchPackages[0].split('/').pop();
      if (first) return first;
    }

    const include = _tomlArrayInSection(
      pyprojectSrc, 'tool.setuptools.packages.find', 'include'
    );
    if (include) {
      const first = include[0].replace(/\*.*$/, '');
      if (first) return first;
    }
  }

  // (b) single package under src/.
  const underSrc = _singlePackageDir(path.join(cwd, 'src'), _NON_PACKAGE_DIRS);
  if (underSrc) return underSrc;

  // (c) single package next to pyproject.toml / setup.py.
  const atRoot = _singlePackageDir(cwd, _NON_PACKAGE_DIRS);
  if (atRoot) return atRoot;

  // Fallback: distribution name from pyproject.toml [project].name.
  if (pyprojectSrc) {
    const m = pyprojectSrc.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
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

module.exports = { detectPythonPrefix, _tomlArrayInSection, _singlePackageDir };
