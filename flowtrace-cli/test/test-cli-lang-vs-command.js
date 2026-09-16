/**
 * The language `flowtrace run` picks must match the command it is about to
 * launch, not just the files lying around in the current directory.
 *
 * The bug: run from the root of a worktree holding a Python service and a
 * `node/` subdirectory, detection saw requirements.txt, answered "python", and
 * `flowtrace run -- node src/app.js` launched the Node program with PYTHONPATH
 * and a Python package prefix. Nothing failed and nothing warned — the Node
 * program ran completely uninstrumented and the trace came out empty, which
 * reads as "my code never ran" rather than "the wrong capture layer was wired
 * up".
 *
 * Run: node test/test-cli-lang-vs-command.js
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { langFromCommand, sameCaptureLayer } = require('../lib/detect');

const BIN = path.join(__dirname, '..', 'bin', 'flowtrace.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

/** A worktree root holding a Python project plus a Node one under node/. */
function polyglotWorktree() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-polyglot-'));
  fs.writeFileSync(path.join(d, 'requirements.txt'), 'fastapi\n');
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[project]\nname = "over_validator"\n');
  fs.mkdirSync(path.join(d, 'node', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(d, 'node', 'package.json'),
    JSON.stringify({ name: '@acme/over-validator-api', type: 'module' })
  );
  fs.writeFileSync(
    path.join(d, 'node', 'src', 'app.js'),
    'function evaluate(pnr) { return { pnr, pct: 7 }; }\nconsole.log(JSON.stringify(evaluate("ABC123")));\n'
  );
  return d;
}

function runFlowtrace(cwd, args) {
  return spawnSync(process.execPath, [BIN, 'run', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

console.log('\n[langFromCommand]');

test('recognises the launchers that can only run one language', () => {
  assert.equal(langFromCommand(['node', 'src/app.js']), 'node');
  assert.equal(langFromCommand(['ts-node', 'src/app.ts']), 'node');
  assert.equal(langFromCommand(['tsx', 'src/app.ts']), 'node');
  assert.equal(langFromCommand(['python', 'app.py']), 'python');
  assert.equal(langFromCommand(['/usr/bin/python3.12', 'app.py']), 'python');
  assert.equal(langFromCommand(['./venv/bin/python', 'app.py']), 'python');
  assert.equal(langFromCommand(['pytest']), 'python');
  assert.equal(langFromCommand(['mvnw', 'test']), 'java');
  assert.equal(langFromCommand(['gradle', 'bootRun']), 'java');
  assert.equal(langFromCommand(['go', 'run', '.']), 'go');
  assert.equal(langFromCommand(['node.exe', 'app.js']), 'node', 'Windows extensions are stripped');
});

test('says nothing about a launcher that could run anything', () => {
  // `npm test` in a polyglot repo routinely shells out to pytest or maven, so
  // correcting on it would be a guess, and a wrong correction is worse than
  // leaving detection alone.
  for (const cmd of [['npm', 'test'], ['pnpm', 'start'], ['yarn', 'dev'], ['npx', 'jest'], ['make', 'run'], [], undefined]) {
    assert.equal(langFromCommand(cmd), null, `${JSON.stringify(cmd)} must not decide the language`);
  }
});

test('node and ts are one capture layer, everything else stands alone', () => {
  assert.equal(sameCaptureLayer('ts', 'node'), true);
  assert.equal(sameCaptureLayer('node', 'ts'), true);
  assert.equal(sameCaptureLayer('python', 'node'), false);
  assert.equal(sameCaptureLayer('java', 'go'), false);
});

console.log('\n[run: cwd says one thing, the command says another]');

test('a node command from a python-looking root warns and traces node anyway', () => {
  const d = polyglotWorktree();
  const out = path.join(d, 'trace.jsonl');
  const r = runFlowtrace(d, ['--out', out, '--', 'node', 'node/src/app.js']);
  const all = `${r.stdout}${r.stderr}`;

  assert.match(all, /el directorio parece python, pero el comando ejecuta node/,
    'the mismatch must be stated, not swallowed');
  assert.match(all, /Node instrumentado/, 'the Node capture layer must be the one wired up');
  assert.doesNotMatch(all, /Python instrumentado/);
  assert.ok(fs.existsSync(out), 'a trace file must exist');
  assert.ok(
    fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).length > 0,
    'the trace must not be empty — an empty one reads as a bug in the application'
  );
});

test('--lang that contradicts the command is refused, not obeyed', () => {
  const d = polyglotWorktree();
  const r = runFlowtrace(d, ['--lang', 'python', '--', 'node', 'node/src/app.js']);
  const all = `${r.stdout}${r.stderr}`;

  assert.equal(r.status, 2, 'refusing is an argument error');
  assert.match(all, /no corresponde al comando/);
  assert.match(all, /Usa --lang node/, 'the message must name the fix');
});

test('--lang node on a node command is left alone', () => {
  const d = polyglotWorktree();
  const out = path.join(d, 'trace.jsonl');
  const r = runFlowtrace(d, ['--lang', 'node', '--out', out, '--', 'node', 'node/src/app.js']);
  const all = `${r.stdout}${r.stderr}`;
  assert.match(all, /Node instrumentado/);
  assert.doesNotMatch(all, /no corresponde al comando/);
});

test('--lang ts on a node command is not a contradiction', () => {
  const d = polyglotWorktree();
  const out = path.join(d, 'trace.jsonl');
  const r = runFlowtrace(d, ['--lang', 'ts', '--out', out, '--', 'node', 'node/src/app.js']);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /no corresponde al comando/,
    'ts and node are the same capture layer');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
