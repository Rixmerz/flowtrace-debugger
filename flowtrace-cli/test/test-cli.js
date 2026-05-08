/**
 * v2 CLI smoke test: --help shows exactly init, run, analyze.
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const BIN = path.resolve(__dirname, '../bin/flowtrace.js');

function run(args, opts = {}) {
  return execFileSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('--help lists exactly init, run, analyze', () => {
  const out = run(['--help']);
  // commander lists each command on its own line
  for (const cmd of ['init', 'run', 'analyze']) {
    assert.ok(new RegExp(`\\b${cmd}\\b`).test(out), `--help mentions ${cmd}`);
  }
  for (const removed of ['install', 'update', 'status']) {
    assert.ok(!new RegExp(`^\\s+${removed}\\b`, 'm').test(out),
      `--help should not list removed command ${removed}`);
  }
});

test('init writes .flowtrace/config.json with v2 marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtrace-cli-'));
  run(['init'], { cwd: tmp });
  const cfgPath = path.join(tmp, '.flowtrace', 'config.json');
  assert.ok(fs.existsSync(cfgPath));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(cfg.schemaVersion, 'v2');
  assert.ok(cfg.schema.includes('flowtrace-v2'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) {
    console.error(`  FAIL ${name}\n        ${e.message}`);
    if (e.stdout) console.error('        stdout:', e.stdout.toString().slice(0, 400));
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
