/**
 * `flowtrace diff` — exit statuses, --json, ignore flags and the ignores file.
 * Runs the real bin against small hand-written traces, so it also proves the
 * vendored bundle is loadable from the package alone.
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const BIN = path.resolve(__dirname, '../bin/flowtrace.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtrace-diff-cli-'));

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, 'diff', ...args], {
    encoding: 'utf-8', cwd: TMP, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, ...opts,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

let seq = 0;
/** One call `app.svc.handle(args) -> result`, with run-specific ids/ts. */
function trace(name, { args = { n: 1 }, result = { ok: true }, extra = [] } = {}, dir = TMP) {
  const run = ++seq;
  const id = (n) => String(run * 1000 + n).padStart(16, '0');
  const ev = (e) => JSON.stringify({ ts: 1e9 + run, trace_id: 'a'.repeat(32), thread: `t${run}`, lang: 'python', module: 'app', class: 'svc', depth: 0, visibility: 'public', ...e });
  const lines = [
    ev({ event: 'enter', span_id: id(1), parent_id: null, method: 'handle', args }),
    ...extra.flatMap((x, i) => [
      ev({ event: 'enter', span_id: id(10 + i), parent_id: id(1), method: x, args: {}, depth: 1 }),
      ev({ event: 'exit', span_id: id(10 + i), parent_id: id(1), method: x, result: {}, duration_ns: run, depth: 1 }),
    ]),
    ev({ event: 'exit', span_id: id(1), parent_id: null, method: 'handle', result, duration_ns: run * 7 }),
  ];
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('same behaviour, different ids/ts/threads: exit 0', () => {
  const r = run([trace('a.jsonl'), trace('b.jsonl')]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /IGUAL/);
});

test('different behaviour: exit 1 and the output names the change', () => {
  const r = run([trace('a.jsonl'), trace('b.jsonl', { result: { ok: false } })]);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /DIFERENTE/);
  assert.match(r.out, /resultado distinto/);
  assert.match(r.out, /result\.ok/);
});

test('--json prints the same object as the MCP tool, and nothing else on stdout', () => {
  const r = run(['--json', trace('a.jsonl'), trace('b.jsonl', { extra: ['audit'] })]);
  assert.equal(r.code, 1);
  const o = JSON.parse(r.out);
  assert.equal(o.verdict, 'different');
  assert.equal(o.summary.calls_added, 1);
  assert.equal(o.complete, true);
  assert.deepEqual(o.samples.calls_added[0].path, ['app.svc.handle', 'app.svc.audit']);
  const { traceBehaviorDiff } = require('../vendor/trace-diff/behavior-diff.bundle.js');
  assert.ok(typeof traceBehaviorDiff === 'function');
});

test('--json with equal traces: exit 0, verdict same', () => {
  const r = run([trace('a.jsonl'), trace('b.jsonl'), '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).verdict, 'same');
});

test('addresses in strings are normalised by default; --no-normalize-addresses compares them verbatim', () => {
  const t = (addr) => ({ args: { cb: `<Foo object at 0x${addr}>`, cut: `<truncated:{"cut":"<f at 0x${addr.slice(0, 5)}...>` } });
  const a = trace('addr-a.jsonl', t('7f3a2c1d9e50'));
  const b = trace('addr-b.jsonl', t('7f99aa001c10'));
  assert.equal(run([a, b]).code, 0);
  const raw = run([a, b, '--no-normalize-addresses']);
  assert.equal(raw.code, 1, raw.out);
  assert.match(raw.out, /args\.cb/);
});

test('--ignore-key makes a volatile argument irrelevant (repeatable)', () => {
  const a = trace('a.jsonl', { args: { n: 1, stamp: 'x' }, result: { ok: true, rid: 1 } });
  const b = trace('b.jsonl', { args: { n: 1, stamp: 'y' }, result: { ok: true, rid: 2 } });
  assert.equal(run([a, b]).code, 1);
  assert.equal(run([a, b, '--ignore-key', 'stamp']).code, 1, 'rid still differs');
  assert.equal(run([a, b, '--ignore-key', 'stamp', '--ignore-key', 'rid']).code, 0);
  assert.equal(run([a, b, '--ignore-key', 'args.stamp', '--ignore-key', 'result.rid']).code, 0, 'anchored paths');
});

test('--ignore-method drops a call and its subtree (glob, repeatable)', () => {
  const a = trace('a.jsonl');
  const b = trace('b.jsonl', { extra: ['log_audit', 'metrics'] });
  assert.equal(run([a, b]).code, 1);
  assert.equal(run([a, b, '--ignore-method', 'app.svc.log_*']).code, 1, 'metrics still added');
  assert.equal(run([a, b, '--ignore-method', 'app.svc.log_*', '--ignore-method', '*.metrics']).code, 0);
});

test('--limit bounds the samples but not the counts', () => {
  const a = trace('a.jsonl');
  const b = trace('b.jsonl', { extra: ['x1', 'x2', 'x3'] });
  const o = JSON.parse(run([a, b, '--json', '--limit', '1']).out);
  assert.equal(o.summary.calls_added, 3);
  assert.equal(o.samples.calls_added.length, 1);
  assert.equal(o.omitted.calls_added, 2);
});

test('characterisation.json next to the baseline supplies default ignores; flags add to it', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'cfg-'));
  const a = trace('base.jsonl', { result: { ok: true, rid: 1 } }, dir);
  const b = trace('cur.jsonl', { result: { ok: true, rid: 2 }, extra: ['metrics'] });
  fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({ ignoreKeys: ['rid'] }));
  assert.equal(run([a, b]).code, 1, 'metrics still differs');
  assert.equal(run([a, b, '--ignore-method', '*.metrics']).code, 0);
});

test('.flowtrace/characterisation.json in the cwd is read when none sits beside the baseline', () => {
  const proj = fs.mkdtempSync(path.join(TMP, 'proj-'));
  fs.mkdirSync(path.join(proj, '.flowtrace'));
  fs.writeFileSync(path.join(proj, '.flowtrace', 'characterisation.json'), JSON.stringify({ ignoreKeys: ['rid'] }));
  const a = trace('pa.jsonl', { result: { rid: 1 } });
  const b = trace('pb.jsonl', { result: { rid: 2 } });
  assert.equal(run([a, b], { cwd: proj }).code, 0);
});

test('a malformed ignores file or unknown key is exit 2, not a silent weaker comparison', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'bad-'));
  const a = trace('base.jsonl', {}, dir);
  const b = trace('cur.jsonl');
  fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({ ignoreKey: ['x'] }));
  const r = run([a, b]);
  assert.equal(r.code, 2);
  assert.match(r.err, /desconocida/);
});

test('ignore entries may be objects that carry their reason; --json shows it next to the ignored item', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'reason-'));
  const a = trace('base.jsonl', { result: { ok: true, rid: 1 } }, dir);
  const b = trace('cur.jsonl', { result: { ok: true, rid: 2 }, extra: ['metrics'] });
  fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({
    ignoreKeys: [{ key: 'rid', reason: 'request id differs per run' }, 'unused'],
    ignoreMethods: [{ name: '*.metrics', reason: 'metrics are not behaviour' }],
    reasons: { unused: 'string entry, reason from the top-level map' },
    $comment: 'free text',
  }));
  const r = run([a, b, '--json']);
  assert.equal(r.code, 0, r.err + r.out);
  const o = JSON.parse(r.out);
  assert.deepEqual(o.ignored.reasons.keys, [
    { pattern: 'rid', reason: 'request id differs per run' },
    { pattern: 'unused', reason: 'string entry, reason from the top-level map' },
  ]);
  assert.deepEqual(o.ignored.reasons.methods, [{ pattern: '*.metrics', reason: 'metrics are not behaviour' }]);
  assert.match(run([a, b]).out, /rid: request id differs per run/, 'the human output states why too');
});

test('plain-string ignores keep working and add no reasons key', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'plain-'));
  const a = trace('base.jsonl', { result: { rid: 1 } }, dir);
  const b = trace('cur.jsonl', { result: { rid: 2 } });
  fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({ ignoreKeys: ['rid'] }));
  const o = JSON.parse(run([a, b, '--json']).out);
  assert.equal(o.ignored.reasons, undefined);
});

test('an ignore object with a key that is neither a name nor a reason is exit 2', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'badentry-'));
  const a = trace('base.jsonl', {}, dir);
  const b = trace('cur.jsonl');
  for (const entry of [{ key: 'rid', reasno: 'typo' }, { reason: 'no name' }, { key: 'rid', reason: 3 }, 7]) {
    fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({ ignoreKeys: [entry] }));
    const r = run([a, b]);
    assert.equal(r.code, 2, JSON.stringify(entry));
    assert.match(r.err, /ignoreKeys/);
  }
  fs.writeFileSync(path.join(dir, 'characterisation.json'), JSON.stringify({ reasons: { x: 1 } }));
  assert.equal(run([a, b]).code, 2, 'reasons must map to strings');
});

test('missing file, missing argument, unknown option and non-v2 input are exit 2', () => {
  const a = trace('a.jsonl');
  assert.equal(run([a, path.join(TMP, 'nope.jsonl')]).code, 2);
  assert.match(run([a, path.join(TMP, 'nope.jsonl')]).err, /No existe/);
  assert.equal(run([a]).code, 2);
  assert.equal(run([a, a, '--bogus']).code, 2);
  assert.equal(run([a, a, '--limit', 'abc']).code, 2);
  const junk = path.join(TMP, 'junk.jsonl');
  fs.writeFileSync(junk, 'not json\n');
  assert.equal(run([a, junk]).code, 2);
  const v1 = path.join(TMP, 'v1.jsonl');
  fs.writeFileSync(v1, JSON.stringify({ timestamp: 1, event: 'ENTER', method: 'x' }) + '\n');
  const r = run([a, v1]);
  assert.equal(r.code, 2);
  assert.match(r.err, /v1/);
});

test('an incomplete comparison (--max-spans hit) never exits 0', () => {
  const a = trace('a.jsonl', { extra: ['x1', 'x2'] });
  const b = trace('b.jsonl', { extra: ['x1', 'x2'] });
  const r = run([a, b, '--max-spans', '2']);
  assert.equal(r.code, 2);
  assert.match(r.err, /incompleta/);
});

test('diff is listed in --help', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf-8' });
  assert.match(r.stdout, /\bdiff\b/);
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
