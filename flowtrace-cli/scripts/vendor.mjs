/**
 * Copies the capture layers into the package before it is published.
 *
 * The whole point of the single-package distribution: a user runs one
 * `npm i -g @rixmerz/flowtrace` and can trace Java, Node, TypeScript and
 * Python, with no Maven, no pip, and no clone. That only works if the assets
 * travel inside the tarball, which is what this produces.
 *
 * Two of the three layers cost almost nothing to carry:
 *
 *   python  164 KB of .py, and the runtime needs no installation at all —
 *           the CLI puts it on PYTHONPATH and the sitecustomize stub does the
 *           rest. Shipping it here removes pip from the user's path entirely.
 *   node    ~110 KB of source. Its dependencies (@swc/core, babel) stay
 *           ordinary npm dependencies, so npm resolves the right native binary
 *           per platform rather than us guessing.
 *   go      the whole capture/go module (cmd/flowtrace-go, flowtracert/,
 *           transform/, go.mod) — a few hundred KB of .go source. There is
 *           nothing to prebuild: flowtrace-go is always run from source via
 *           `go run`, so vendoring it is just a copy, the same as Python.
 *   java    the 2.3 MB shaded extension jar. The 24 MB OpenTelemetry agent is
 *           deliberately NOT vendored — see assets.js.
 *
 * Run by `prepack`, so `npm pack` and `npm publish` cannot produce a tarball
 * that is missing them.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..');
const VENDOR = join(PKG, 'vendor');

function fail(msg) {
  console.error(`[vendor] ${msg}`);
  process.exit(1);
}

/** Copies a directory, skipping the noise that must never ship. */
function copyDir(from, to, label) {
  if (!existsSync(from)) fail(`missing ${label}: ${from}`);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    // .flowtrace/ is the runtime's own default output directory (see
    // capture/go/flowtracert/emitter.go, capture/python's emitter.py) — a
    // run artifact that can be sitting in a checkout, never something to
    // ship in the tarball.
    filter: (src) => !/(node_modules|__pycache__|\.pytest_cache|\.egg-info|\.flowtrace)/.test(src),
  });
  console.log(`[vendor] ${label} -> ${to.replace(PKG, '<pkg>')}`);
}

rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(VENDOR, { recursive: true });

// Node + browser capture: source only. package.json comes along so the layout
// matches a checkout and assets.js needs no special case.
copyDir(join(REPO, 'capture', 'node', 'src'), join(VENDOR, 'node', 'src'), 'node capture');
copyDir(join(REPO, 'capture', 'browser', 'src'), join(VENDOR, 'browser', 'src'), 'browser capture');

// Python: the runtime package and the sitecustomize stub. No install needed.
copyDir(join(REPO, 'capture', 'python', 'flowtrace_runtime'),
        join(VENDOR, 'python', 'flowtrace_runtime'), 'python runtime');
copyDir(join(REPO, 'capture', 'python', 'stub'),
        join(VENDOR, 'python', 'stub'), 'python stub');

// Go: the whole module (driver, runtime source, transformer, go.mod). No
// install needed either — `go run` builds it fresh, from source, every time.
copyDir(join(REPO, 'capture', 'go'), join(VENDOR, 'go'), 'go capture');

// Java: the shaded jar, located by prefix and newest-wins for the same reason
// assets.js does — target/ holds the previous release's jar after a bump.
const target = join(REPO, 'capture', 'java', 'flowtrace-otel-extension', 'target');
if (!existsSync(target)) fail('java target/ missing — run `make build-java` first');
const jars = readdirSync(target)
  .filter((n) => n.startsWith('flowtrace-otel-extension-') && n.endsWith('.jar') && !n.startsWith('original-'))
  .map((n) => join(target, n));
if (jars.length === 0) fail('no shaded jar in target/ — run `make build-java` first');
const jar = jars.reduce((a, b) => (statSync(a).mtimeMs >= statSync(b).mtimeMs ? a : b));
mkdirSync(join(VENDOR, 'java'), { recursive: true });
cpSync(jar, join(VENDOR, 'java', jar.split('/').pop()));
console.log(`[vendor] java extension -> <pkg>/vendor/java/${jar.split('/').pop()}`);

console.log('[vendor] done');
