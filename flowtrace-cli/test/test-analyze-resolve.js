/**
 * Tests for lib/commands/analyze.js's resolveDashboardServer() — AC2.
 *
 * Builds a fixture tree per branch under a tmp dir, mirroring the two real
 * layouts' relative structure, and calls resolveDashboardServer(baseDir)
 * against it. This runs identically whether or not `make bundle-dashboard`
 * has been run in this checkout — it never touches this repo's own files.
 * Run: node test/test-analyze-resolve.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const analyzeCommand = require('../lib/commands/analyze');
const resolveDashboardServer = analyzeCommand._resolveDashboardServer;

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

// baseDir mirrors flowtrace-cli/lib/commands/ — resolveDashboardServer looks
// for '../../vendor/dashboard/server/server.bundle.js' (flowtrace-cli/vendor/...)
// and '../../../flowtrace-dashboard/server/server.js' (sibling of flowtrace-cli/).
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtrace-analyze-resolve-'));
  const baseDir = path.join(root, 'flowtrace-cli', 'lib', 'commands');
  const bundled = path.join(root, 'flowtrace-cli', 'vendor', 'dashboard', 'server', 'server.bundle.js');
  const fromSource = path.join(root, 'flowtrace-dashboard', 'server', 'server.js');
  fs.mkdirSync(baseDir, { recursive: true });
  return { root, baseDir, bundled, fromSource };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\n[resolveDashboardServer]');

// ---- branch 1: installed-package layout (bundle present) ----
{
  const { root, baseDir, bundled } = makeFixture();
  try {
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, '// fixture bundle\n');
    const result = resolveDashboardServer(baseDir);
    assert(result === bundled, 'bundle present -> returns bundled path, not monorepo source');
  } finally {
    cleanup(root);
  }
}

// ---- branch 2: monorepo/local-dev layout (bundle absent, source present) ----
{
  const { root, baseDir, fromSource } = makeFixture();
  try {
    fs.mkdirSync(path.dirname(fromSource), { recursive: true });
    fs.writeFileSync(fromSource, '// fixture source\n');
    const result = resolveDashboardServer(baseDir);
    assert(result === fromSource, 'bundle absent, monorepo source present -> falls back to flowtrace-dashboard/server/server.js');
  } finally {
    cleanup(root);
  }
}

// ---- branch 3: neither present -> null ----
{
  const { root, baseDir } = makeFixture();
  try {
    const result = resolveDashboardServer(baseDir);
    assert(result === null, 'neither bundle nor monorepo source present -> null (caller prints "No se encontro el dashboard")');
  } finally {
    cleanup(root);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
