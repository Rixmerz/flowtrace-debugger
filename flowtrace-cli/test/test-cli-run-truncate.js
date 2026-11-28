/**
 * `flowtrace run -o <file>` starts from an empty file; `--append` keeps the
 * old behaviour.
 *
 * The bug: the capture layers append, so two runs into the same name doubled
 * the trace and a later `flowtrace diff` reported a difference between two
 * runs of the same program.
 *
 * Run: node test/test-cli-run-truncate.js
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'flowtrace.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}

function nodeProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-truncate-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'app' }));
  fs.writeFileSync(path.join(d, 'app.js'), 'function evaluate(n) { return { n }; }\nevaluate(1);\n');
  return d;
}

function run(cwd, extra) {
  const out = path.join(cwd, 'trace.jsonl');
  const r = spawnSync(process.execPath, [BIN, 'run', '--lang', 'node', '--out', out, ...extra, '--', 'node', 'app.js'], {
    cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length;
}

test('two runs into the same --out give the same trace, not a doubled one', () => {
  const d = nodeProject();
  const first = run(d, []);
  assert.ok(first > 0, 'the first run must capture something');
  assert.equal(run(d, []), first, 'the second run must start from an empty file');
});

test('a stale file with other content is replaced', () => {
  const d = nodeProject();
  fs.writeFileSync(path.join(d, 'trace.jsonl'), 'stale\nstale\n');
  const n = run(d, []);
  assert.ok(!fs.readFileSync(path.join(d, 'trace.jsonl'), 'utf8').includes('stale'));
  assert.ok(n > 0);
});

test('--append keeps what is there and adds to it', () => {
  const d = nodeProject();
  const first = run(d, []);
  assert.equal(run(d, ['--append']), first * 2, '--append must add to the existing trace');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
