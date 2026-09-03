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
const crypto = require('crypto');

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
const OTEL_BASE =
  `https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/${OTEL_VERSION}`;
const OTEL_URL = `${OTEL_BASE}/opentelemetry-javaagent-${OTEL_VERSION}.jar`;

/**
 * SHA-256 of that exact jar, from Maven Central's own `.jar.sha256` next to it.
 *
 * This file is handed to the JVM as `-javaagent:`, which means it runs before
 * the user's main() with full access to the process. Downloading it over TLS
 * says only that *something* answered as repo1.maven.org; it says nothing
 * about a corrupted transfer, a cache in between, or a compromised mirror. The
 * digest is what makes "this is the artifact the OTel project published" a
 * checkable claim rather than an assumption.
 *
 * Update this together with OTEL_VERSION — the download fails closed if they
 * disagree, which is the intended behaviour.
 */
const OTEL_SHA256 = '9d6bc2ad8dd8fb7f730984988e57b8ac0a82d81c7b3b8ae795378718733a509d';

/** No progress for this long means the connection is wedged, not slow. */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

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

/**
 * Downloads `url` to `dest`, verifying `expectedSha256` before the file is put
 * in place. Follows redirects (Maven Central serves them) but only to https,
 * so a redirect cannot downgrade the transport.
 */
function download(url, dest, expectedSha256, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft === 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, url);
        if (next.protocol !== 'https:') {
          return reject(new Error(`refusing a redirect to ${next.protocol}//: the agent must arrive over https`));
        }
        return resolve(download(next.href, dest, expectedSha256, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      // Write to a temp name and verify before renaming: an interrupted or
      // tampered download must not leave a jar behind that every later run
      // then treats as cached — and this one is passed to `-javaagent:`.
      const tmp = `${dest}.partial`;
      const file = fs.createWriteStream(tmp);
      res.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
        res.destroy(new Error(`no data for ${DOWNLOAD_IDLE_TIMEOUT_MS}ms`));
      });
      res.pipe(file);
      res.on('error', (e) => { file.destroy(); fs.rmSync(tmp, { force: true }); reject(e); });
      file.on('finish', () => file.close(async () => {
        try {
          await verifyAndPlace(tmp, dest, expectedSha256);
          resolve(dest);
        } catch (e) { reject(e); }
      }));
      file.on('error', (e) => { fs.rmSync(tmp, { force: true }); reject(e); });
    });
    req.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`connection to ${url} timed out`));
    });
    req.on('error', reject);
  });
}

/**
 * Checks a downloaded file against its expected digest and, only then, moves
 * it into place. A mismatch deletes the file and fails: shipping "it probably
 * downloaded fine" for something the JVM loads before main() is not a trade
 * worth making.
 */
async function verifyAndPlace(tmp, dest, expectedSha256) {
  if (expectedSha256) {
    const actual = await sha256File(tmp);
    if (actual !== expectedSha256) {
      fs.rmSync(tmp, { force: true });
      throw new Error(
        `checksum mismatch: expected sha256 ${expectedSha256}, got ${actual}. ` +
        'The file was discarded and nothing was loaded into the JVM.'
      );
    }
  }
  fs.renameSync(tmp, dest);
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
  await download(OTEL_URL, dest, OTEL_SHA256);
  log('Checksum sha256 verificado.');
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
  OTEL_SHA256,
  verifyAndPlace,
  sha256File,
};
