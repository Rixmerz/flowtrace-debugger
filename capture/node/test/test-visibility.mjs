/**
 * The `visibility` field, across every way a method can be non-public.
 *
 * Labelling private calls is the capability that distinguishes FlowTrace from
 * ordinary framework-level tracing, and it silently did not work for TypeScript:
 * swc strips TS before Babel parses, so `private` and `protected` were gone by
 * the time the instrumentation pass ran and every such method was reported as
 * public. `private` is far more common in TypeScript codebases than the `#field`
 * syntax, so the headline feature was broken for the language it is most used in.
 *
 * The values are also constrained: the schema enum is
 * public | private | internal | unknown. There is no "protected" — Java used to
 * emit it verbatim, which made every protected method's events schema-invalid.
 * TypeScript's `protected` maps to `internal` here for the same reason.
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
const FIXTURES = join(__dirname, 'fixtures/vis');

/** The only values schema/flowtrace-v2.json permits. */
const PERMITTED = new Set(['public', 'private', 'internal', 'unknown']);

function run(entry) {
  const outDir = join(
    tmpdir(),
    `ft-vis-${process.pid}-${Math.random().toString(36).slice(2)}`
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
    const events = existsSync(outPath)
      ? readFileSync(outPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    return { ...result, events };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** visibility of the enter event for a given method name. */
function visOf(events, method) {
  const ev = events.find((e) => e.method === method && e.event === 'enter');
  assert.ok(ev, `method ${method} was not traced`);
  return ev.visibility;
}

test('TypeScript `private` is reported as private, not public', () => {
  const { events, stderr } = run('entry.mjs');
  assert.ok(events.length > 0, `no events. stderr:\n${stderr}`);

  // The regression this test exists for: swc had already deleted the modifier.
  assert.equal(visOf(events, 'priv'), 'private');
});

test('TypeScript `protected` maps to internal, a value the schema permits', () => {
  const { events } = run('entry.mjs');
  assert.equal(visOf(events, 'prot'), 'internal');
});

test('a #private field method is private, and public methods stay public', () => {
  const { events } = run('entry.mjs');
  assert.equal(visOf(events, '#hard'), 'private', '#field privacy is real JS privacy');
  assert.equal(visOf(events, 'pub'), 'public');
  assert.equal(visOf(events, 'all'), 'public', 'an unannotated method is public');
});

test('every emitted visibility is inside the schema enum', () => {
  // Java emitting "protected" is precisely how this went wrong there; assert the
  // constraint directly rather than trusting the mapping.
  const { events } = run('entry.mjs');
  for (const e of events) {
    assert.ok(
      PERMITTED.has(e.visibility),
      `visibility "${e.visibility}" on ${e.method} is not in the schema enum`
    );
  }
});

test('all four access levels are distinguishable in one trace', () => {
  // The practical consequence: a consumer filtering for non-public work must be
  // able to separate the levels. Before the fix it saw only public and #private.
  const { events } = run('entry.mjs');
  const byVis = new Map();
  for (const e of events.filter((x) => x.event === 'enter')) {
    if (!byVis.has(e.visibility)) byVis.set(e.visibility, []);
    byVis.get(e.visibility).push(e.method);
  }
  assert.ok(byVis.has('private'), 'no private methods distinguished');
  assert.ok(byVis.has('internal'), 'no internal (protected) methods distinguished');
  assert.ok(byVis.has('public'), 'no public methods distinguished');
});
