/**
 * TypeScript loading and the `lang` field.
 *
 * Both were broken in ways that produced no error:
 *
 *   - The ESM loader called nextLoad() before doing anything else, and Node's
 *     default loader throws ERR_UNKNOWN_FILE_EXTENSION for .ts, so TypeScript
 *     was unloadable over ESM entirely.
 *   - The runtime helpers hardcoded lang:'node', so even a .ts file that did
 *     load reported itself as plain Node. The schema's "ts" enum value, the
 *     CLI's ts support and examples/golden/ts all described a value the emitter
 *     could never produce, and a consumer filtering lang == "ts" matched
 *     nothing, ever.
 *
 * These tests spawn real processes and assert on the emitted JSONL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(__dirname, '../src/bootstrap.mjs');
const FIXTURES = join(__dirname, 'fixtures/lang');

/**
 * Run a fixture under the bootstrap and return its emitted events.
 * @param {string} entry - filename inside fixtures/lang
 */
function runFixture(entry) {
  const outDir = join(
    tmpdir(),
    `ft-lang-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');

  try {
    const result = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, entry], {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '',
        NODE_OPTIONS: '',
      },
      cwd: FIXTURES,
      timeout: 30000,
      encoding: 'utf8',
    });

    assert.ok(
      existsSync(outPath),
      `no trace emitted for ${entry}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
    return readFileSync(outPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test('a .ts module loads over ESM and reports lang "ts"', () => {
  // entry.mjs imports ./typed.ts — before the fix this threw
  // ERR_UNKNOWN_FILE_EXTENSION and emitted nothing at all.
  const events = runFixture('entry.mjs');

  assert.ok(events.length > 0, 'TypeScript produced no events');
  const langs = new Set(events.map((e) => e.lang));
  assert.deepEqual([...langs], ['ts'], 'every event from a .ts source must be lang "ts"');

  const greet = events.find((e) => e.method === 'greet' && e.event === 'enter');
  assert.ok(greet, 'expected the TS class method to be instrumented');
  assert.equal(greet.class, 'Typed');
  assert.equal(greet.module, 'typed');
});

test('a .js module still reports lang "node"', () => {
  // Regression guard for the other direction: threading lang through must not
  // relabel plain JavaScript.
  const events = runFixture('plain.js');

  assert.ok(events.length > 0);
  const langs = new Set(events.map((e) => e.lang));
  assert.deepEqual([...langs], ['node']);
});

test('lang is consistent between the enter and exit of one span', () => {
  // enter takes lang as an argument; exit reads it back off the span ctx. A
  // mismatch would split one span across two languages in the log.
  for (const entry of ['entry.mjs', 'plain.js']) {
    const events = runFixture(entry);
    const bySpan = new Map();
    for (const e of events) {
      if (!bySpan.has(e.span_id)) bySpan.set(e.span_id, new Set());
      bySpan.get(e.span_id).add(e.lang);
    }
    for (const [spanId, langs] of bySpan) {
      assert.equal(langs.size, 1, `span ${spanId} in ${entry} reported langs ${[...langs]}`);
    }
  }
});

test('lang is one of the values the schema permits', () => {
  // schema/flowtrace-v2.json $defs.lang.enum — an out-of-enum value would be
  // dropped by every consumer as malformed rather than reported as an error.
  const permitted = new Set(['java', 'python', 'node', 'ts']);
  for (const entry of ['entry.mjs', 'plain.js']) {
    for (const e of runFixture(entry)) {
      assert.ok(permitted.has(e.lang), `lang "${e.lang}" is not in the schema enum`);
    }
  }
});
