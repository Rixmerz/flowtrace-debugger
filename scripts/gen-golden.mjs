#!/usr/bin/env node
/**
 * Regenerate examples/golden/<fixture>/expected.jsonl by running each fixture
 * under its real capture layer and normalizing the output.
 *
 * Usage:
 *   node scripts/gen-golden.mjs              # every available fixture
 *   node scripts/gen-golden.mjs node ts      # only these
 *
 * This WRITES fixtures. To verify without writing, use check-golden.mjs.
 */

import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURES } from './golden/runners.mjs';
import { normalizeJsonl } from './golden/normalize.mjs';

const only = process.argv.slice(2);
const selected = only.length ? FIXTURES.filter((f) => only.includes(f.id)) : FIXTURES;

if (only.length && selected.length !== only.length) {
  const known = FIXTURES.map((f) => f.id).join(', ');
  console.error(`ERROR: unknown fixture(s). Known: ${known}`);
  process.exit(2);
}

let written = 0;
let skipped = 0;
let failed = 0;

for (const fixture of selected) {
  const availability = fixture.available();
  if (!availability.ok) {
    console.warn(`SKIP  ${fixture.id}: ${availability.reason}`);
    skipped += 1;
    continue;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'ft-golden-'));
  const outPath = join(scratch, 'trace.jsonl');

  try {
    const result = fixture.run(outPath);

    if (result.error) {
      console.error(`FAIL  ${fixture.id}: ${result.error.message}`);
      failed += 1;
      continue;
    }
    if (result.status !== 0) {
      console.error(`FAIL  ${fixture.id}: exited ${result.status}\n${result.stderr ?? ''}`);
      failed += 1;
      continue;
    }
    if (!existsSync(outPath)) {
      console.error(`FAIL  ${fixture.id}: capture produced no output file`);
      failed += 1;
      continue;
    }

    const normalized = normalizeJsonl(readFileSync(outPath, 'utf8'));
    const eventCount = normalized.trim().split('\n').length;
    if (eventCount === 0 || normalized.trim() === '') {
      console.error(`FAIL  ${fixture.id}: capture emitted zero events`);
      failed += 1;
      continue;
    }

    writeFileSync(join(fixture.dir, 'expected.jsonl'), normalized, 'utf8');
    console.log(`WROTE ${fixture.id}: ${eventCount} events`);
    written += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`\nWrote ${written}, skipped ${skipped}, failed ${failed}.`);
process.exit(failed === 0 ? 0 : 1);
