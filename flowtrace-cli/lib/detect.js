/**
 * Language auto-detection for flowtrace-cli.
 * detectLang(cwd)          -> 'java'|'python'|'node'|'ts'|'go'|'rust'|null|string[]
 * detectPackagePrefix(cwd, lang) -> string|null
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { detectPythonPrefix } = require('./python-prefix');
const { detectGoModulePath } = require('./go-module');
const { detectRustPackageName } = require('./rust-package');

/**
 * Returns 'java'|'python'|'node'|'ts'|'go'|'rust'|null
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

  // Rust: Cargo.toml
  if (has('Cargo.toml')) {
    detected.push('rust');
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
 * @returns {'java'|'python'|'node'|'go'|'rust'|null}
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
  if (bin === 'cargo') return 'rust';
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
  if (lang === 'rust') return detectRustPackageName(cwd);
  return null;
}

// ---- Java ----
/** The project's own <groupId>: the first one outside <parent>/<dependencies>/etc. */
function _pomOwnGroupId(src) {
  const stripped = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<parent>[\s\S]*?<\/parent>/g, '')
    .replace(/<(dependencies|dependencyManagement|build|profiles|plugins|reporting)>[\s\S]*?<\/\1>/g, '');
  const m = stripped.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/);
  return m ? m[1].trim() : null;
}

/** Package (dotted) of every .java file under src/main/java, from its path. */
function _javaSourcePackages(cwd) {
  const root = path.join(cwd, 'src', 'main', 'java');
  const pkgs = [];
  const walk = (dir, parts) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...parts, e.name]);
      else if (e.name.endsWith('.java') && parts.length) pkgs.push(parts);
    }
  };
  walk(root, []);
  return pkgs;
}

function _longestCommonPackage(pkgs) {
  if (!pkgs.length) return null;
  let common = pkgs[0];
  for (const p of pkgs.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
  }
  return common.length ? common.join('.') : null;
}

function _javaPrefix(cwd) {
  const pomPath = path.join(cwd, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    // The groupId inside <parent> is the PARENT's (org.springframework.boot for
    // a Spring Boot app) and matches none of the project's own classes. Use the
    // project's own, and only when sources actually live under it; otherwise the
    // longest common package of src/main/java is the honest answer.
    const own = _pomOwnGroupId(fs.readFileSync(pomPath, 'utf-8'));
    const pkgs = _javaSourcePackages(cwd);
    const common = _longestCommonPackage(pkgs);
    const under = (pkg, root) => pkg === root || pkg.startsWith(root + '.');
    // The common package is the tightest prefix that still matches every class,
    // so it wins when it sits inside the groupId (PetClinic: groupId
    // org.springframework.samples, code in ...samples.petclinic).
    if (common && (!own || under(common, own))) return common;
    if (own && (!pkgs.length || pkgs.some((p) => under(p.join('.'), own)))) return own;
    if (common) return common;
    if (own) return own;
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
