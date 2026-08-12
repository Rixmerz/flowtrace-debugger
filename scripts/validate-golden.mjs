#!/usr/bin/env node
/**
 * Validate every line of every golden expected.jsonl against
 * schema/flowtrace-v2.json.
 *
 * A missing fixture is a FAILURE, not a skip. The previous version warned
 * "SKIP <lang>: no expected.jsonl" and exited 0 — with every fixture missing
 * (they were unwittingly gitignored) CI's declared baseline contract reported
 * "Validated 0 events across 0 fixtures" and passed. Green on an empty set is
 * indistinguishable from green on a passing set, which is the worst property a
 * gate can have.
 *
 * Uses Ajv 2020-12. Run via: node scripts/validate-golden.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { FIXTURE_IDS } from './golden/runners.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const schemaPath = join(repoRoot, 'schema', 'flowtrace-v2.json');
const goldenRoot = join(repoRoot, 'examples', 'golden');

let Ajv2020;
try {
  ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
} catch (e) {
  console.error('ERROR: ajv not installed. Run: pnpm install (in scripts/)');
  console.error(e.message);
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

let totalLines = 0;
let totalFiles = 0;
let failures = 0;

for (const id of FIXTURE_IDS) {
  const fixturePath = join(goldenRoot, id, 'expected.jsonl');

  if (!existsSync(fixturePath)) {
    failures += 1;
    console.error(
      `FAIL ${id}: missing expected.jsonl. Regenerate with ` +
      `\`node scripts/gen-golden.mjs ${id}\`.`
    );
    continue;
  }

  const raw = readFileSync(fixturePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    failures += 1;
    console.error(`FAIL ${id}: expected.jsonl is empty.`);
    continue;
  }

  totalFiles += 1;
  let fixtureFailures = 0;
  let lineNo = 0;

  for (const line of lines) {
    lineNo += 1;
    totalLines += 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      fixtureFailures += 1;
      console.error(`FAIL ${id}:${lineNo}  invalid JSON: ${e.message}`);
      continue;
    }
    if (!validate(obj)) {
      fixtureFailures += 1;
      console.error(`FAIL ${id}:${lineNo}`);
      for (const err of validate.errors) {
        console.error(`  ${err.instancePath || '/'} ${err.message}`);
      }
    }
  }

  failures += fixtureFailures;
  if (fixtureFailures === 0) console.log(`OK   ${id}: ${lines.length} events`);
}

// Belt and braces: even if the fixture list itself were emptied, refuse to
// report success on zero verified events.
if (totalFiles === 0 || totalLines === 0) {
  console.error('\nFAIL: no fixtures validated — refusing to report success on an empty set.');
  process.exit(1);
}

console.log(
  `\nValidated ${totalLines} events across ${totalFiles} fixtures. Failures: ${failures}.`
);
process.exit(failures === 0 ? 0 : 1);
