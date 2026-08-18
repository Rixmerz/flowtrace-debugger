#!/usr/bin/env node
/**
 * Golden regression check: re-run every fixture under its real capture layer,
 * normalize the output, and diff it against the committed expected.jsonl.
 *
 * Schema validation (validate-golden.mjs) only proves an event is well-shaped.
 * This proves the capture still produces the *same trace* — call tree, depths,
 * visibility, args, results. That is the actual contract.
 *
 * Usage:
 *   node scripts/check-golden.mjs              # all fixtures
 *   node scripts/check-golden.mjs node ts      # subset
 *
 * Env:
 *   FLOWTRACE_GOLDEN_STRICT=1   treat an unavailable fixture as a failure
 *                               instead of a skip (CI sets this).
 */

import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURES } from './golden/runners.mjs';
import { normalizeJsonl } from './golden/normalize.mjs';

const STRICT = process.env.FLOWTRACE_GOLDEN_STRICT === '1';

const only = process.argv.slice(2);
const selected = only.length ? FIXTURES.filter((f) => only.includes(f.id)) : FIXTURES;

if (only.length && selected.length !== only.length) {
  console.error(`ERROR: unknown fixture(s). Known: ${FIXTURES.map((f) => f.id).join(', ')}`);
  process.exit(2);
}

/** First differing line, rendered for a human. */
function firstDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i += 1) {
    if (e[i] !== a[i]) {
      return [
        `  first difference at line ${i + 1}:`,
        `    expected: ${e[i] ?? '<missing>'}`,
        `    actual:   ${a[i] ?? '<missing>'}`,
      ].join('\n');
    }
  }
  return '  (files differ only in trailing whitespace)';
}

let passed = 0;
let skipped = 0;
let failed = 0;

for (const fixture of selected) {
  const expectedPath = join(fixture.dir, 'expected.jsonl');

  if (!existsSync(expectedPath)) {
    failed += 1;
    console.error(`FAIL  ${fixture.id}: no expected.jsonl — run \`node scripts/gen-golden.mjs ${fixture.id}\``);
    continue;
  }

  const availability = fixture.available();
  if (!availability.ok) {
    if (STRICT) {
      failed += 1;
      console.error(`FAIL  ${fixture.id}: ${availability.reason} (FLOWTRACE_GOLDEN_STRICT=1)`);
    } else {
      skipped += 1;
      console.warn(`SKIP  ${fixture.id}: ${availability.reason}`);
    }
    continue;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'ft-check-'));
  const outPath = join(scratch, 'trace.jsonl');

  try {
    const result = fixture.run(outPath);

    if (result.error) {
      failed += 1;
      console.error(`FAIL  ${fixture.id}: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      failed += 1;
      console.error(`FAIL  ${fixture.id}: exited ${result.status}\n${result.stderr ?? ''}`);
      continue;
    }
    if (!existsSync(outPath)) {
      failed += 1;
      console.error(`FAIL  ${fixture.id}: capture produced no output file`);
      continue;
    }

    const actual = normalizeJsonl(readFileSync(outPath, 'utf8'));
    const expected = readFileSync(expectedPath, 'utf8');

    if (actual === expected) {
      passed += 1;
      console.log(`OK    ${fixture.id}: ${actual.trim().split('\n').length} events match`);
    } else {
      failed += 1;
      console.error(`FAIL  ${fixture.id}: capture output drifted from expected.jsonl`);
      console.error(firstDiff(expected, actual));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`\nGolden check: ${passed} passed, ${skipped} skipped, ${failed} failed.`);

if (failed === 0 && passed === 0) {
  console.error('FAIL: nothing was actually checked.');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
