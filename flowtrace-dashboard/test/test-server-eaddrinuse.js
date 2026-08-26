/**
 * AC4 — the dashboard server fails loud and clean on EADDRINUSE, not with an
 * unhandled-exception stack trace, and leaves no orphaned process behind.
 *
 * Starts two `node server.js` back to back on the same port: the second must
 * print the one-line message and exit non-zero; `ps`/`lsof` must show no
 * leftover process from the failed attempt.
 *
 * Run: node test/test-server-eaddrinuse.js
 */
'use strict';

const path = require('path');
const http = require('http');
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
    return [];
  }
}

async function main() {
  const PORT = 18766; // dedicated test port
  const serverPath = path.resolve(__dirname, '..', 'server', 'server.js');
  const env = { ...process.env, PORT: String(PORT) };

  console.log('\n[AC4 EADDRINUSE]');
  assert(pidsOnPort(PORT).length === 0, `precondition: nothing already listening on ${PORT}`);

  const first = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const up = await waitForHealth(PORT);
  assert(up, 'first server: comes up and /health returns 200');

  let secondOut = '';
  let secondExit = null;
  const second = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  second.stdout.on('data', (d) => { secondOut += d.toString(); });
  second.stderr.on('data', (d) => { secondOut += d.toString(); });
  await new Promise((resolve) => {
    second.on('close', (code) => { secondExit = code; resolve(); });
  });

  assert(secondExit === 1, `second server exits non-zero on EADDRINUSE (got ${secondExit})`);
  assert(/already in use/.test(secondOut), 'second server prints the clean one-line EADDRINUSE message');
  assert(!/at Server\.setupListenHandle/.test(secondOut) && !/throw er;/.test(secondOut), 'second server output has no raw uncaught-exception stack trace');

  await sleep(300); // give the OS a moment to reap the failed process, if any
  const remaining = pidsOnPort(PORT);
  assert(remaining.length === 1, `exactly one process (the first server) still owns port ${PORT} after the failed attempt (found ${remaining.length})`);

  first.kill('SIGKILL');
  for (const pid of pidsOnPort(PORT)) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
