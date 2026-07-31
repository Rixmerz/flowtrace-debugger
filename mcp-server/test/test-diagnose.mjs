/**
 * A load problem must be stated to the MCP CLIENT, not only to stderr.
 *
 * loadJsonl already warned on stderr for a v1 file. That is invisible where it
 * matters: the MCP transport speaks over stdio, so stderr reaches the server's own
 * log and never the agent calling the tool. What the agent received was
 * `{ count: 0, schemaVersion: "v1", malformed: 2 }` — facts that need
 * interpreting, and the natural reading of `count: 0` is "this trace is empty".
 * That is a confidently wrong conclusion drawn from a correct-looking response.
 *
 * The partial case is worse: log.aggregate and log.search then return
 * authoritative numbers computed over whatever fraction survived, with nothing to
 * say the rest was dropped.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { diagnoseLoad } from '../dist/lib/diagnose.js';
import { loadJsonl } from '../dist/lib/jsonl.js';

const GOLDEN = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../examples/golden/node/expected.jsonl'
);

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

async function atest(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-diag-'));
const file = (name, content) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
};

console.log('\nload diagnosis reaches the client\n');

// ── pure function behaviour ────────────────────────────────────────
test('a clean v2 load produces no warning', () => {
  assert.equal(diagnoseLoad('/x.jsonl', 'v2', 12, 0).warning, null);
});

test('a v1 file says so, and says no converter exists', () => {
  const { warning } = diagnoseLoad('/x.jsonl', 'v1', 0, 2);
  assert.ok(warning, 'no warning for a v1 file');
  assert.match(warning, /v1 trace, not v2/);
  assert.match(warning, /no converter exists/);
  // The agent must be told what to do, not just what happened.
  assert.match(warning, /Re-capture/);
});

test('everything dropped is distinguished from an empty trace', () => {
  const dropped = diagnoseLoad('/x.jsonl', 'v2', 0, 5).warning;
  const empty = diagnoseLoad('/x.jsonl', 'v2', 0, 0).warning;
  assert.ok(dropped && empty, 'both cases need a warning');
  assert.notEqual(dropped, empty, 'the two zero-event causes must read differently');
  // The instruction that prevents the wrong conclusion.
  assert.match(dropped, /Do NOT read this as an empty trace/);
  // The empty case points at the likely cause instead.
  assert.match(empty, /package prefix/);
});

test('a partial load reports the proportion lost', () => {
  const { warning } = diagnoseLoad('/x.jsonl', 'v2', 90, 10);
  assert.ok(warning, 'a partial load must warn');
  assert.match(warning, /10 of 100/);
  assert.match(warning, /10\.0%/);
  // Aggregates over partial data are the real hazard.
  assert.match(warning, /lower bound/);
});

// ── against real files ─────────────────────────────────────────────
await atest('a real v1 log is diagnosed as v1', async () => {
  const p = file('v1.jsonl', [
    '{"timestamp":1700000000123,"event":"ENTER","thread":"main","class":"C","method":"run","args":"{}"}',
    '{"timestamp":1700000000456,"event":"EXIT","thread":"main","class":"C","method":"run","durationMillis":333}',
  ].join('\n') + '\n');

  const r = await loadJsonl(p);
  assert.equal(r.schemaVersion, 'v1');
  assert.equal(r.rows.length, 0);
  const { warning } = diagnoseLoad(p, r.schemaVersion, r.rows.length, r.malformed);
  assert.match(warning, /v1 trace/);
});

await atest('the golden v2 fixture loads without a warning', async () => {
  // Guards against a diagnosis that fires on healthy input, which would train
  // the reader to ignore it.
  const r = await loadJsonl(GOLDEN);
  assert.ok(r.rows.length > 0, 'golden fixture produced no rows');
  const { warning } = diagnoseLoad(GOLDEN, r.schemaVersion, r.rows.length, r.malformed);
  assert.equal(warning, null, `unexpected warning on clean input: ${warning}`);
});

await atest('a v2 file with one bad line warns but still yields data', async () => {
  const good = fs.readFileSync(GOLDEN, 'utf8').trim().split('\n').slice(0, 6);
  const p = file('partial.jsonl', good.concat('{"garbage":true}').join('\n') + '\n');

  const r = await loadJsonl(p);
  assert.equal(r.rows.length, 6, 'good lines should survive');
  assert.equal(r.malformed, 1);
  const { warning } = diagnoseLoad(p, r.schemaVersion, r.rows.length, r.malformed);
  assert.match(warning, /1 of 7/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
