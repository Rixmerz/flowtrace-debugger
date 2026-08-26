/**
 * AC1 — `flowtrace analyze` opens the trace already loaded.
 *
 * Runs `flowtrace analyze <jsonl>` as a real subprocess against a real
 * golden JSONL fixture, captures the URL it opens (via a fake `open`/
 * `xdg-open` shim on PATH, since there's no browser in CI), extracts
 * `?analysis=<id>`, and curls `GET /api/analyze/<id>` on the live server to
 * confirm it returns real analyzed results for that specific file — not an
 * empty dashboard. Covers both the freshly-spawned-server path and the
 * already-running-server-reused path, plus the POST-failure fallback (must
 * still open the bare URL, never hang or crash).
 *
 * Run: node test/test-analyze-autoload.js
 */
'use strict';

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const http    = require('http');
const { spawn, execSync } = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* leave null */ }
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', reject);
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function waitForHealth(port, retries = 40, intervalMs = 250) {
  for (let i = 0; i < retries; i++) {
    if (await checkHealth(port)) return true;
    await sleep(intervalMs);
  }
  return false;
}

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function killPort(port) {
  for (const pid of pidsOnPort(port)) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * A fake `open`/`xdg-open`/`cmd` on PATH that just appends the URL it was
 * asked to open to a file, instead of actually opening a browser (there is
 * none in CI). analyzeCommand's openBrowser() spawns `open` on darwin,
 * `xdg-open` elsewhere, `cmd` on win32 — this repo runs macOS/linux CI, so
 * shim both `open` and `xdg-open` to be safe.
 */
function makeOpenShim(dir) {
  const capturedFile = path.join(dir, 'opened-url.txt');
  const shimDir = path.join(dir, 'bin');
  fs.mkdirSync(shimDir, { recursive: true });
  const script = `#!/bin/sh\necho "$@" >> "${capturedFile}"\n`;
  for (const name of ['open', 'xdg-open']) {
    const p = path.join(shimDir, name);
    fs.writeFileSync(p, script);
    fs.chmodSync(p, 0o755);
  }
  return { shimDir, capturedFile };
}

function readOpenedUrl(capturedFile, retries = 20, intervalMs = 250) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < retries; i++) {
      if (fs.existsSync(capturedFile)) {
        const content = fs.readFileSync(capturedFile, 'utf8').trim();
        if (content) return resolve(content.split('\n').pop().trim());
      }
      await sleep(intervalMs);
    }
    resolve(null);
  });
}

async function main() {
  const bin = path.resolve(__dirname, '..', 'bin', 'flowtrace.js');
  const goldenJsonl = path.resolve(__dirname, '..', '..', 'examples', 'golden', 'java', 'expected.jsonl');
  assert(fs.existsSync(goldenJsonl), 'precondition: golden java fixture exists');

  // ============ Scenario 1: fresh spawn ============
  {
    console.log('\n[AC1 fresh-spawn: analysis pre-loaded]');
    const PORT = 18766; // dedicated, distinct from dedup test's 18765 and default 8765
    killPort(PORT);
    assert(pidsOnPort(PORT).length === 0, `precondition: nothing listening on ${PORT}`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-autoload-fresh-'));
    const { shimDir, capturedFile } = makeOpenShim(tmp);
    const env = {
      ...process.env,
      FLOWTRACE_DASHBOARD_PORT: String(PORT),
      PATH: `${shimDir}:${process.env.PATH}`,
    };

    const child = spawn(process.execPath, [bin, 'analyze', goldenJsonl], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    const up = await waitForHealth(PORT);
    assert(up, 'fresh spawn: server comes up and /health returns 200');

    const openedUrl = await readOpenedUrl(capturedFile);
    assert(!!openedUrl, 'fresh spawn: openBrowser was invoked with a URL');
    assert(!!openedUrl && /\?analysis=/.test(openedUrl), `fresh spawn: opened URL contains ?analysis= (got: ${openedUrl})`);

    if (openedUrl && /\?analysis=/.test(openedUrl)) {
      const analysisId = openedUrl.split('?analysis=')[1].trim();
      const { statusCode, body } = await httpGetJson(`http://localhost:${PORT}/api/analyze/${analysisId}`);
      assert(statusCode === 200, `fresh spawn: GET /api/analyze/${analysisId} returns 200 (got ${statusCode})`);
      assert(!!body && body.fileName === 'expected.jsonl', `fresh spawn: returned analysis fileName matches the analyzed file (got ${body && body.fileName})`);
      assert(!!body && body.results && body.results.fileStats && body.results.fileStats.totalEvents > 0, 'fresh spawn: returned analysis has real (non-empty) event data');
    }

    killPort(PORT);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }

  // ============ Scenario 2: reuse already-running server ============
  {
    console.log('\n[AC1 reuse: analysis pre-loaded on already-running server]');
    const PORT = 18767;
    killPort(PORT);

    const tmpServer = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-autoload-reuse-server-'));
    const { shimDir: shimA } = makeOpenShim(tmpServer);
    const envA = { ...process.env, FLOWTRACE_DASHBOARD_PORT: String(PORT), PATH: `${shimA}:${process.env.PATH}` };

    // Start the server once (first analyze call spawns it).
    const first = spawn(process.execPath, [bin, 'analyze', goldenJsonl], { cwd: tmpServer, env: envA, stdio: ['ignore', 'pipe', 'pipe'] });
    const up = await waitForHealth(PORT);
    assert(up, 'reuse: first invocation brings server up');

    // Second invocation, different file, must reuse the running server and
    // still pre-load + open with ?analysis=.
    const secondJsonl = path.resolve(__dirname, '..', '..', 'examples', 'golden', 'python', 'expected.jsonl');
    assert(fs.existsSync(secondJsonl), 'precondition: golden python fixture exists');

    const tmpClient = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-autoload-reuse-client-'));
    const { shimDir: shimB, capturedFile: capturedB } = makeOpenShim(tmpClient);
    const envB = { ...process.env, FLOWTRACE_DASHBOARD_PORT: String(PORT), PATH: `${shimB}:${process.env.PATH}` };

    let secondOut = '';
    try {
      secondOut = execSync(`"${process.execPath}" "${bin}" analyze "${secondJsonl}"`, { cwd: tmpClient, env: envB, timeout: 10000 }).toString();
    } catch (e) {
      secondOut = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    }
    assert(/ya esta corriendo/.test(secondOut), 'reuse: second invocation reports reuse, not a fresh spawn');

    // AC3: the reuse path must still pre-load the trace (postAnalyzeFile is
    // called, so the URL it prints carries ?analysis=) but must NOT open a
    // browser tab — assert against the `open`/`xdg-open` shim (the
    // `_openBrowser` test-injection point for a real subprocess) never
    // being invoked, not by mocking the function in-process.
    assert(/view this trace at:/.test(secondOut), `reuse: stdout prints the "view this trace at" message instead of opening a tab (got: ${JSON.stringify(secondOut)})`);
    // Extract the pre-loaded URL specifically (stdout also logs the bare
    // `dashboard: http://localhost:PORT` line earlier without ?analysis=) —
    // match on the ?analysis= query string, not just any localhost URL, and
    // don't split on the message text since chalk wraps it in ANSI codes.
    const printedUrlMatch = secondOut.match(/(http:\/\/localhost:\d+\?analysis=\S+)/);
    assert(!!printedUrlMatch, `reuse: stdout contains the pre-loaded dashboard URL with ?analysis= (got: ${JSON.stringify(secondOut)})`);
    const printedUrl = printedUrlMatch && printedUrlMatch[1];
    assert(!!printedUrl && /\?analysis=/.test(printedUrl), `reuse: printed URL contains ?analysis= — postAnalyzeFile ran (got: ${printedUrl})`);

    const openedUrl = await readOpenedUrl(capturedB, 4, 250); // short poll: we expect this to NEVER appear
    assert(!openedUrl, `reuse: openBrowser (the open/xdg-open shim) was NOT invoked (got: ${openedUrl})`);

    if (printedUrl && /\?analysis=/.test(printedUrl)) {
      const analysisId = printedUrl.split('?analysis=')[1].trim();
      const { statusCode, body } = await httpGetJson(`http://localhost:${PORT}/api/analyze/${analysisId}`);
      assert(statusCode === 200, `reuse: GET /api/analyze/${analysisId} returns 200 (got ${statusCode})`);
      assert(!!body && body.fileName === 'expected.jsonl' && body.filePath === secondJsonl, `reuse: returned analysis is for the SECOND file, not the first (filePath: ${body && body.filePath})`);
    }

    killPort(PORT);
    try { first.kill('SIGKILL'); } catch { /* already gone */ }
  }

  // ============ Scenario 3: POST-failure fallback still opens dashboard ============
  {
    console.log('\n[AC1 fallback: pre-load failure still opens bare URL, never hangs]');
    const PORT = 18768;
    killPort(PORT);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-autoload-fallback-'));
    // A *directory* named `broken.jsonl`. analyze.js's own fs.existsSync
    // check (before spawning) passes — existsSync doesn't distinguish files
    // from dirs — and the server's own '.jsonl' extension + existsSync
    // checks also pass, but FlowTraceAnalyzer.analyze() then does an
    // fs.readFileSync/createReadStream against it and throws EISDIR,
    // producing a 500 from /api/analyze-file. This exercises
    // buildOpenUrl's null-analysisId fallback path for real, unlike a
    // malformed-but-still-a-file jsonl (which the analyzer tolerates and
    // still returns an analysisId for, just with empty stats).
    const badFile = path.join(tmp, 'broken.jsonl');
    fs.mkdirSync(badFile);

    const { shimDir, capturedFile } = makeOpenShim(tmp);
    const env = { ...process.env, FLOWTRACE_DASHBOARD_PORT: String(PORT), PATH: `${shimDir}:${process.env.PATH}` };

    const child = spawn(process.execPath, [bin, 'analyze', badFile], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    const up = await waitForHealth(PORT);
    assert(up, 'fallback: server still comes up even though the target file is malformed');

    const openedUrl = await readOpenedUrl(capturedFile);
    assert(!!openedUrl, 'fallback: openBrowser was still invoked (never hangs/crashes on pre-load failure)');
    assert(!!openedUrl && !/\?analysis=/.test(openedUrl), `fallback: opened URL is the BARE url, no ?analysis= (got: ${openedUrl})`);
    assert(/no se pudo pre-cargar/i.test(out), 'fallback: stderr contains the pre-load-failed warning');

    killPort(PORT);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
