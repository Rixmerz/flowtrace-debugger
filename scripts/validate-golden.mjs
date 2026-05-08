#!/usr/bin/env node
/**
 * Validate every line of every examples/golden/<lang>/expected.jsonl
 * against schema/flowtrace-v2.json.
 *
 * Uses Ajv 2020-12. Run via: npx --yes ajv-formats ajv@8 — but Ajv
 * has no built-in CLI for JSONL. We bundle our own here.
 *
 * Exit non-zero if any line fails validation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const schemaPath = join(repoRoot, 'schema', 'flowtrace-v2.json');
const goldenRoot = join(repoRoot, 'examples', 'golden');

let Ajv2020;
try {
  ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
} catch (e) {
  console.error('ERROR: ajv not installed. Run: npm install --no-save ajv@^8');
  console.error(e.message);
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

let totalLines = 0;
let totalFiles = 0;
let failures = 0;

const langDirs = readdirSync(goldenRoot).filter(d =>
  statSync(join(goldenRoot, d)).isDirectory()
);

for (const lang of langDirs) {
  const fixturePath = join(goldenRoot, lang, 'expected.jsonl');
  let raw;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch {
    console.warn(`SKIP ${lang}: no expected.jsonl`);
    continue;
  }
  totalFiles += 1;
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    totalLines += 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      failures += 1;
      console.error(`FAIL ${lang}:${lineNo}  invalid JSON: ${e.message}`);
      continue;
    }
    if (!validate(obj)) {
      failures += 1;
      console.error(`FAIL ${lang}:${lineNo}`);
      for (const err of validate.errors) {
        console.error(`  ${err.instancePath || '/'} ${err.message}`);
      }
    }
  }
  console.log(`OK   ${lang}: ${lines.length} lines`);
}

console.log(
  `\nValidated ${totalLines} events across ${totalFiles} fixtures. ` +
  `Failures: ${failures}.`
);
process.exit(failures === 0 ? 0 : 1);
