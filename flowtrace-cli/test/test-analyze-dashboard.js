'use strict';
/**
 * `flowtrace analyze` end to end against a real dashboard process.
 *
 * The command's entire purpose is to open the dashboard ON a specific trace, and
 * it never did: it passed FLOWTRACE_FILE to the dashboard process and nothing
 * read it, so the browser opened on an empty dashboard and the user had to locate
 * and upload the same file by hand.
 *
 * It also spawned a server unconditionally. With the port already taken the child
 * died on an unhandled EADDRINUSE event while the CLI went on to announce the URL
 * and open the browser — pointing at whatever was already listening. A stale
 * dashboard from an earlier run looks like a working one; that cost real debugging
 * time during the audit that found this, which is the strongest argument for the
 * test below.
 *
 * These tests bind a real port, so they run serially and always clean up.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'flowtrace.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN_NODE = path.join(REPO_ROOT, 'examples', 'golden', 'node', 'calculator.js');
const DASHBOARD_DEPS = path.join(REPO_ROOT, 'flowtrace-dashboard', 'node_modules', 'express');

// Distinct ports per scenario, deliberately. Sharing one made the second scenario
// depend on the first releasing it — and it does not: `analyze` spawns the
// dashboard as a CHILD, so killing the CLI leaves the dashboard holding the
// socket. Separate ports keep the scenarios independent of that.
const PORT_PRELOAD = 8791;
const PORT_CONFLICT = 8792;
const URL = `http://localhost:${PORT_PRELOAD}`;

let pass = 0;
let fail = 0;
let skip = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

// A real async sleep. The first version shelled out with spawnSync, which BLOCKS
// the event loop — so listen() could never complete and no 'error' event could
// fire while "waiting" for it. The squatter below silently never bound, analyze
// then started its own server perfectly well, and the failure surfaced as a
// confusing message about exit codes. Same silent-failure shape as everything
// else this audit has turned up, this time in the test.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A project directory containing a real captured trace. */
function projectWithTrace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ana-'));
  fs.copyFileSync(GOLDEN_NODE, path.join(dir, 'calculator.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p' }));
  const r = spawnSync(process.execPath, [CLI, 'run', '--', 'node', 'calculator.js'], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const traceDir = path.join(dir, '.flowtrace');
  const traces = fs.existsSync(traceDir)
    ? fs.readdirSync(traceDir).filter((f) => f.endsWith('.jsonl'))
    : [];
  assert.ok(traces.length > 0, `no trace produced to analyze:\n${r.stdout}\n${r.stderr}`);
  return dir;
}

function runAnalyze(dir, port, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, 'analyze', '--last'], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
    env: {
      ...process.env,
      FLOWTRACE_DASHBOARD_PORT: String(port),
      // Never actually open a browser from a test.
      BROWSER: 'none',
      ...extraEnv,
    },
  });
}

/** GET a JSON endpoint, or null if it is not answering yet. */
async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return await res.json();
  } catch {
    return null;
  }
}

if (!fs.existsSync(DASHBOARD_DEPS)) {
  // Reported, not silently passed: an unrunnable check is not a passing one.
  console.log('\nanalyze -> dashboard\n');
  console.log('  SKIP  dashboard dependencies missing — run `npm install` in flowtrace-dashboard/');
  console.log('\n0 passed, 0 failed, 1 skipped\n');
  process.exit(0);
}

async function main() {
console.log('\nanalyze -> dashboard\n');

// ── the trace is actually loaded ───────────────────────────────────
{
  const dir = projectWithTrace();
  let server = null;
  try {
    // analyze spawns and keeps the server alive, so run it detached and poll.
    server = spawn(process.execPath, [CLI, 'analyze', '--last'], {
      cwd: dir,
      env: { ...process.env, FLOWTRACE_DASHBOARD_PORT: String(PORT_PRELOAD), BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    server.stdout.on('data', (d) => { out += d.toString(); });
    server.stderr.on('data', (d) => { out += d.toString(); });

    // Wait for readiness rather than a fixed sleep.
    let listing = null;
    for (let i = 0; i < 40 && !listing; i++) {
      await sleep(500);
      listing = await getJson(`${URL}/api/analyze`);
    }

    test('the dashboard pre-loads the trace instead of starting empty', () => {
      assert.ok(listing, `dashboard never answered on ${URL}:\n${out}`);
      assert.strictEqual(
        listing.analyses.length, 1,
        `expected exactly one pre-loaded analysis, got ${JSON.stringify(listing.analyses)}`
      );
      assert.ok(listing.analyses[0].totalEvents > 0, 'pre-loaded analysis has no events');
    });

    let pushed = null;
    test('a second analyze reuses the running dashboard', () => {
      // The normal workflow is run/analyze/run/analyze; a second spawn would hit
      // EADDRINUSE and previously left the user on a stale page.
      const r = runAnalyze(dir, PORT_PRELOAD);
      assert.ok(
        /ya en ejecución/i.test(r.stdout),
        `expected reuse of the live dashboard:\n${r.stdout}\n${r.stderr}`
      );
      assert.strictEqual(r.status, 0, `analyze failed: ${r.stderr}`);
      pushed = r;
    });
    // Asserted after the sync test block, because it needs an await.
    if (pushed && pushed.status === 0) {
      const after = await getJson(`${URL}/api/analyze`);
      test('the pushed trace is registered alongside the pre-loaded one', () => {
        assert.ok(after, 'dashboard stopped answering');
        assert.strictEqual(after.analyses.length, 2, 'the pushed trace was not registered');
      });
    }
  } finally {
    if (server) {
      // SIGINT so the CLI forwards it and its dashboard child exits too; a plain
      // SIGKILL leaves the grandchild holding the port.
      server.kill('SIGINT');
      await sleep(600);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    await sleep(800);
  }
}

// ── the port occupied by something else ────────────────────────────
{
  const dir = projectWithTrace();

  // The squatter runs in its OWN PROCESS. Serving it from this one cannot work:
  // runAnalyze uses spawnSync, which blocks this process's event loop for the
  // duration of the CLI run, so the CLI's probe request to /health would never be
  // answered — it would time out, the CLI would conclude the port was free, and
  // the test would prove the opposite of what it claims. Third time this exact
  // mistake appeared while writing this file, which is a good argument for
  // keeping the note.
  const squatter = spawn(process.execPath, ['-e', `
    require('http').createServer((_q, s) => s.end('not a dashboard'))
      .listen(${PORT_CONFLICT}, () => console.log('READY'));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    // listen() reports failure via an 'error' event, not a throw. Without this
    // handler a bind failure — the previous scenario's socket still in TIME_WAIT
    // — left NOTHING listening, analyze then started its own server perfectly
    // well, and the test failed with a misleading message about exit codes. The
    // same silent-failure shape this whole audit has been about, in the test
    // itself.
    let ready = false;
    let squatterOut = '';
    squatter.stdout.on('data', (d) => { squatterOut += d.toString(); if (/READY/.test(squatterOut)) ready = true; });
    squatter.stderr.on('data', (d) => { squatterOut += d.toString(); });
    for (let i = 0; i < 40 && !ready && squatter.exitCode === null; i++) await sleep(250);
    assert.ok(
      ready,
      `port ${PORT_CONFLICT} never bound, so the test would prove nothing: ${squatterOut}`
    );

    test('a foreign service on the port is reported, not silently used', () => {
      const r = runAnalyze(dir, PORT_CONFLICT);
      assert.notStrictEqual(r.status, 0, 'analyze should fail when the port is taken');
      assert.ok(
        /ocupado por otro servicio/i.test(r.stdout + r.stderr),
        `expected a port-conflict message:\n${r.stdout}\n${r.stderr}`
      );
      // And it must NOT claim success.
      assert.ok(
        !/Dashboard listo/i.test(r.stdout),
        'announced a ready dashboard that is not ours'
      );
    });
  } finally {
    squatter.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}\n`);
process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n  harness error:', err.message, '\n');
  process.exit(1);
});
