/**
 * CJS integration test — spawns calculator.js with the CJS hook active
 * and asserts the JSONL output matches the expected event structure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP  = join(__dirname, '../src/bootstrap.mjs');
const CALCULATOR = join(__dirname, '../../../examples/golden/node/calculator.js');

function spawnWithBootstrap(scriptPath, outPath) {
  return spawnSync(
    process.execPath,
    ['--import', `file://${BOOTSTRAP}`, scriptPath],
    {
      env: {
        ...process.env,
        FLOWTRACE_OUTPUT: outPath,
        FLOWTRACE_PACKAGE_PREFIX: '',  // empty = instrument all non-node_modules under cwd
        NODE_OPTIONS: '',              // clear to avoid double-import
      },
      cwd: dirname(scriptPath),
      timeout: 15000,
      encoding: 'utf8',
    }
  );
}

test('CJS integration: calculator.js emits 8 JSONL events', () => {
  const outDir  = join(tmpdir(), `ft-cjs-test-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');

  try {
    const result = spawnWithBootstrap(CALCULATOR, outPath);

    if (result.status !== 0) {
      // Show stderr for debugging but don't hard-fail on swc build warn.
      const errLines = (result.stderr ?? '').split('\n').filter(l => l.trim());
      const fatalErrors = errLines.filter(l =>
        !l.includes('[flowtrace]') &&
        !l.includes('ExperimentalWarning') &&
        !l.includes('DeprecationWarning') &&
        !l.includes('Warning')
      );
      if (fatalErrors.length > 0) {
        assert.fail(`Process exited ${result.status}:\n${result.stderr}`);
      }
    }

    assert.ok(existsSync(outPath), `JSONL output file should exist at ${outPath}`);

    const lines = readFileSync(outPath, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l));

    // Golden expects 8 events: run(enter) add(enter) #validate x2(enter+exit) #validate x2(enter+exit) add(exit) run(exit)
    assert.equal(lines.length, 8, `Expected 8 events, got ${lines.length}`);

    // All events should have required fields.
    for (const ev of lines) {
      assert.ok(ev.ts, 'event.ts required');
      assert.ok(ev.trace_id, 'event.trace_id required');
      assert.ok(ev.span_id, 'event.span_id required');
      assert.ok(['enter', 'exit'].includes(ev.event), `event.event must be enter|exit, got ${ev.event}`);
      assert.equal(ev.lang, 'node', 'event.lang should be node');
      assert.equal(ev.class, 'Calculator', 'event.class should be Calculator');
    }

    // Check call structure: first enter should be run(), depth 0.
    const enters = lines.filter(e => e.event === 'enter');
    assert.equal(enters[0].method, 'run', 'first enter should be run()');
    assert.equal(enters[0].depth, 0, 'run() should be at depth 0');

    const validateEnters = enters.filter(e => e.method === '#validate');
    assert.equal(validateEnters.length, 2, 'should have 2 #validate enter events');
    assert.equal(validateEnters[0].visibility, 'private', '#validate should be private');

    // All events share same trace_id.
    const traceIds = new Set(lines.map(e => e.trace_id));
    assert.equal(traceIds.size, 1, 'all events should share one trace_id');

  } finally {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  }
});

test('CJS integration: parent_id chain is correct', () => {
  const outDir  = join(tmpdir(), `ft-cjs-chain-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'trace.jsonl');

  try {
    spawnWithBootstrap(CALCULATOR, outPath);

    if (!existsSync(outPath)) {
      // Skip if no output (swc native not available in CI, etc.)
      return;
    }

    const lines = readFileSync(outPath, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l));

    const enters = lines.filter(e => e.event === 'enter');
    const byMethod = Object.fromEntries(enters.map(e => [e.method + '_' + e.depth, e]));

    const runEv  = enters.find(e => e.method === 'run');
    const addEv  = enters.find(e => e.method === 'add');
    const valEv  = enters.find(e => e.method === '#validate');

    assert.equal(runEv.parent_id, null, 'run() parent_id should be null');
    assert.equal(addEv.parent_id, runEv.span_id, 'add() parent should be run()');
    assert.equal(valEv.parent_id, addEv.span_id, '#validate() parent should be add()');

  } finally {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  }
});
