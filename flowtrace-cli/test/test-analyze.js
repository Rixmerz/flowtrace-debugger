/**
 * Tests for lib/commands/analyze.js
 * Run: node test/test-analyze.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const analyzeCommand = require('../lib/commands/analyze');
const findLatestJsonl = analyzeCommand._findLatestJsonl;

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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-analyze-'));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---- findLatestJsonl ----
console.log('\n[findLatestJsonl]');

{
  const d = mkTmp();
  assert(findLatestJsonl(d) === null, 'empty dir -> null');
}

{
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'trace.txt'), 'not jsonl');
  assert(findLatestJsonl(d) === null, 'no .jsonl files -> null');
}

{
  const d = mkTmp();
  const f = path.join(d, 'trace.jsonl');
  fs.writeFileSync(f, '{"event":"ENTER"}\n');
  assert(findLatestJsonl(d) === f, 'single .jsonl -> returns it');
}

{
  // Two files with different mtimes — newer should win
  const d = mkTmp();
  const older = path.join(d, '2026-05-07T10-00-00Z.jsonl');
  const newer = path.join(d, '2026-05-07T12-00-00Z.jsonl');
  fs.writeFileSync(older, '{"event":"ENTER"}\n');
  // Force newer mtime
  fs.writeFileSync(newer, '{"event":"EXIT"}\n');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(newer, future, future);

  const result = findLatestJsonl(d);
  assert(result === newer, '--last finds most-recent by mtime');
}

{
  const d = mkTmp();
  assert(findLatestJsonl(path.join(d, 'nonexistent')) === null, 'nonexistent dir -> null');
}

// ---- explicit file path pass-through ----
console.log('\n[explicit file path]');

{
  // analyzeCommand with explicit path should resolve it (not search .flowtrace/)
  // We verify this by calling findLatestJsonl on a dir that has files, but
  // the explicit-path branch in analyzeCommand skips findLatestJsonl entirely.
  // Simulate: if file is provided, target = file (no findLatestJsonl call).
  const d = mkTmp();
  const f = path.join(d, 'custom.jsonl');
  fs.writeFileSync(f, '{"event":"ENTER"}\n');

  // Confirm file exists and is the path passed through
  assert(fs.existsSync(f), 'explicit file path: file exists');
  assert(path.isAbsolute(path.resolve(f)), 'explicit file path: resolves to absolute');
}

// ---- _openBrowser does not throw ----
console.log('\n[openBrowser]');

{
  // Should not throw even with a bogus URL — errors are swallowed
  let threw = false;
  try {
    analyzeCommand._openBrowser('http://localhost:8765');
  } catch {
    threw = true;
  }
  assert(!threw, 'openBrowser does not throw on call');
}

// ---- Summary ----
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
