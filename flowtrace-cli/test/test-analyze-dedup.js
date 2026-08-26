/**
 * AC3 — no redundant server, no redundant tab.
 *
 * Runs `flowtrace analyze` twice against a distinct test port (never 8765,
 * to avoid colliding with a dashboard a developer might already have open)
 * and asserts: exactly one server process ends up owning the port, and the
 * second invocation's own stdout shows it reused rather than spawned.
 *
 * Run: node test/test-analyze-dedup.js
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
    return []; // lsof exits non-zero when nothing is listening
  }
}

async function main() {
  const PORT = 18765; // dedicated test port, distinct from the default 8765
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-dedup-'));
  fs.mkdirSync(path.join(cwd, '.flowtrace'));
  const fileA = path.join(cwd, '.flowtrace', 'a.jsonl');
  const fileB = path.join(cwd, '.flowtrace', 'b.jsonl');
  fs.writeFileSync(fileA, '{"event":"ENTER"}\n');
  fs.writeFileSync(fileB, '{"event":"EXIT"}\n');

  const bin = path.resolve(__dirname, '..', 'bin', 'flowtrace.js');
  const env = { ...process.env, FLOWTRACE_DASHBOARD_PORT: String(PORT) };

  assert(pidsOnPort(PORT).length === 0, `precondition: nothing already listening on ${PORT}`);

  console.log('\n[AC3 dedup]');

  // First invocation: spawns a server, must run detached from this test so it
  // stays alive after `flowtrace analyze` itself finishes its own steady
  // state (the process only exits when the dashboard child exits).
  const first = spawn(process.execPath, [bin, 'analyze', fileA], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let firstOut = '';
  first.stdout.on('data', (d) => { firstOut += d.toString(); });
  first.stderr.on('data', (d) => { firstOut += d.toString(); });

  const up = await waitForHealth(PORT);
  assert(up, 'first invocation: server comes up and /health returns 200');

  const pidsAfterFirst = pidsOnPort(PORT);
  assert(pidsAfterFirst.length === 1, `exactly one process owns port ${PORT} after first invocation (found ${pidsAfterFirst.length})`);

  // Second invocation while the first dashboard is still up. This process
  // runs to completion on its own (the "already running" branch returns
  // immediately rather than waiting on a child).
  let secondOut = '';
  try {
    secondOut = execSync(`"${process.execPath}" "${bin}" analyze "${fileB}"`, {
      cwd,
      env,
      timeout: 10000,
    }).toString();
  } catch (e) {
    secondOut = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
  }

  assert(/ya esta corriendo/.test(secondOut), 'second invocation: reports dashboard already running, does not attempt a spawn');
  assert(!/Iniciando servidor/.test(secondOut), 'second invocation: never logs "Iniciando servidor" (no spawn attempt)');

  const pidsAfterSecond = pidsOnPort(PORT);
  assert(pidsAfterSecond.length === 1, `still exactly one process owns port ${PORT} after second invocation (found ${pidsAfterSecond.length})`);
  assert(
    pidsAfterSecond.length === 1 && pidsAfterFirst.length === 1 && pidsAfterSecond[0] === pidsAfterFirst[0],
    'the one process after both invocations is the same PID the first invocation started (no replacement, no second)'
  );

  // Cleanup: kill whatever ended up owning the port, then the harness process.
  for (const pid of pidsOnPort(PORT)) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
  }
  try { first.kill('SIGKILL'); } catch { /* already gone */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
