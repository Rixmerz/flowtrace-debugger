'use strict';

/**
 * Locates the capture assets the CLI injects into a traced process.
 *
 * The CLI has to work in two layouts and they are not alike:
 *
 *   published   <pkg>/vendor/{node,python,browser,java}   — everything is
 *               inside the installed package, because npm gave the user one
 *               directory and nothing else exists on their machine.
 *   repository  <repo>/capture/{node,python,browser} and the Maven target/
 *               — the working copy, where the jar is wherever the last build
 *               put it.
 *
 * Resolution prefers the CHECKOUT and falls back to the vendored copy. That
 * order is deliberate and was originally the other way round, which is wrong:
 * vendor/ is a build artifact left behind by `npm pack`, so a contributor who
 * had ever packed the CLI would silently trace against a stale snapshot of
 * their own capture layer instead of the code they were editing — with nothing
 * on screen to say so. An installed package has no checkout beside it, so it
 * reaches the vendored copy anyway.
 *
 * This replaced a `path.resolve(__dirname, '..', '..', '..')` that assumed the
 * CLI sat at <repo>/flowtrace-cli/lib/commands/ — true only in a checkout. From
 * an npm install it walked out of the package into whatever happened to be
 * three levels up.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

/** <pkg> — the root of this package, in either layout. */
const PKG_ROOT = path.resolve(__dirname, '..');

/** <repo> when running from a checkout; may not exist once installed. */
const REPO_ROOT = path.resolve(PKG_ROOT, '..');

const VENDOR = path.join(PKG_ROOT, 'vendor');

/** First existing path, or null. */
function firstExisting(...candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** True when running from the published package rather than a checkout. */
function isVendored() {
  return fs.existsSync(VENDOR);
}

/** Node capture bootstrap (`--import` target). */
function nodeBootstrap() {
  return firstExisting(
    path.join(REPO_ROOT, 'capture', 'node', 'src', 'bootstrap.mjs'),
    path.join(VENDOR, 'node', 'src', 'bootstrap.mjs')
  );
}

/** Directory holding sitecustomize.py. */
function pythonStubDir() {
  return firstExisting(
    path.join(REPO_ROOT, 'capture', 'python', 'stub'),
    path.join(VENDOR, 'python', 'stub')
  );
}

/** Directory containing the flowtrace_runtime package (goes on PYTHONPATH). */
function pythonRuntimeParent() {
  return firstExisting(
    path.join(REPO_ROOT, 'capture', 'python'),
    path.join(VENDOR, 'python')
  );
}

/**
 * capture/go — the Go module holding cmd/flowtrace-go (the driver `flowtrace
 * run --lang go` shells out to via `go run`), flowtracert/ (the runtime
 * source injected into the target module, byte-for-byte, per D1) and
 * transform/ (the byte-splicing instrumenter). Unlike Java's jar, there is
 * nothing to prebuild here — the driver is always run from source, so this
 * just resolves the directory itself.
 */
function goCaptureDir() {
  return firstExisting(
    path.join(REPO_ROOT, 'capture', 'go'),
    path.join(VENDOR, 'go')
  );
}

/**
 * The shaded FlowTrace OTel extension jar.
 *
 * Located by prefix and picking the most recently modified match, never by an
 * exact filename: the name carries the version, so a hardcoded one goes stale
 * on every release — as it had, still pointing at a 2.0.0-SNAPSHOT jar two
 * versions later. And after a bump the Maven target/ holds both jars, with a
 * directory order that is filesystem-dependent, so "the first match" could
 * silently be the previous release.
 */
function javaExtensionJar() {
  const vendored = path.join(VENDOR, 'java');
  const built = path.join(REPO_ROOT, 'capture', 'java', 'flowtrace-otel-extension', 'target');
  for (const dir of [built, vendored]) {
    if (!fs.existsSync(dir)) continue;
    const hits = fs.readdirSync(dir)
      .filter((n) => n.startsWith('flowtrace-otel-extension-') && n.endsWith('.jar') && !n.startsWith('original-'))
      .map((n) => path.join(dir, n));
    if (hits.length === 0) continue;
    return hits.reduce((a, b) =>
      (fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs ? a : b));
  }
  return null;
}

// ── OpenTelemetry agent ──────────────────────────────────────

/**
 * The OTel javaagent is ~24 MB and is not ours, so it is not shipped inside the
 * package: that would quadruple the download for every user, including those
 * who never trace Java. It is fetched on first Java use and cached in
 * ~/.flowtrace/, the way Playwright handles browsers.
 */
const OTEL_VERSION = '2.30.0';
const OTEL_URL =
  `https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/${OTEL_VERSION}/opentelemetry-javaagent-${OTEL_VERSION}.jar`;

function cacheDir() {
  return process.env.FLOWTRACE_CACHE_DIR || path.join(os.homedir(), '.flowtrace');
}

function otelAgentPath() {
  return path.join(cacheDir(), `opentelemetry-javaagent-${OTEL_VERSION}.jar`);
}

/** A previously downloaded or vendored agent, or null. */
function findOtelAgent() {
  return firstExisting(
    otelAgentPath(),
    path.join(REPO_ROOT, 'capture', 'java', 'flowtrace-otel-extension', 'target',
      'dependency', 'opentelemetry-javaagent.jar'),
    path.join(VENDOR, 'java', 'opentelemetry-javaagent.jar')
  );
}

/** Follows redirects; Maven Central serves them. */
function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft === 0) return reject(new Error('too many redirects'));
        return resolve(download(res.headers.location, dest, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      // Write to a temp name and rename: an interrupted download must not leave
      // a truncated jar behind that every later run then treats as cached.
      const tmp = `${dest}.partial`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try {
          fs.renameSync(tmp, dest);
          resolve(dest);
        } catch (e) { reject(e); }
      }));
      file.on('error', (e) => { fs.rmSync(tmp, { force: true }); reject(e); });
    }).on('error', reject);
  });
}

/**
 * Returns the OTel agent path, downloading it once if needed.
 * @param {(msg: string) => void} [log]
 */
async function ensureOtelAgent(log = () => {}) {
  const existing = findOtelAgent();
  if (existing) return existing;

  const dest = otelAgentPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`Descargando el agente OpenTelemetry ${OTEL_VERSION} (~24 MB, sólo la primera vez)…`);
  await download(OTEL_URL, dest);
  return dest;
}

module.exports = {
  PKG_ROOT,
  REPO_ROOT,
  VENDOR,
  isVendored,
  nodeBootstrap,
  pythonStubDir,
  pythonRuntimeParent,
  goCaptureDir,
  javaExtensionJar,
  findOtelAgent,
  ensureOtelAgent,
  otelAgentPath,
  cacheDir,
  OTEL_VERSION,
  OTEL_URL,
};
