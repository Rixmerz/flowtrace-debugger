/**
 * Every TypeScript/JavaScript extension the layer claims to support must be both
 * loadable and instrumented.
 *
 * The two hooks kept independent extension lists that had drifted apart:
 * src/esm/loader.mjs listed .js .mjs .cjs .ts .tsx .mts .cts, while
 * src/cjs/hook.js omitted .cts (and .mts, which is unreachable there anyway).
 *
 * The .cts omission was not cosmetic. Node resolves `require('./x.cts')` and
 * hands the source to Module._compile, but performs no type stripping of its own,
 * so it died on the first type annotation. Since the extension was not listed,
 * FlowTrace declined to intercept and the file could not be loaded at all —
 * declining to instrument was what made it unloadable.
 *
 * Each case asserts the program's own output AND that events were emitted, so a
 * test cannot pass because instrumentation silently did nothing.
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
const FIXTURES = join(__dirname, 'fixtures/exts');

function run(entry) {
  const outDir = join(
    tmpdir(),
    `ft-exts-${process.pid}-${Math.random().toString(36).slice(2)}`
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

test('.cts loads through the CJS hook and is instrumented as ts', () => {
  const { stdout, stderr, events } = run('entry-cts.cjs');

  // Before .cts was listed in the CJS hook this threw a SyntaxError on the
  // first type annotation and produced no output.
  assert.match(stdout ?? '', /cts result 2/, `stderr:\n${stderr}`);
  assert.ok(events.length > 0, 'no events emitted for .cts');

  const fn = events.find((e) => e.method === 'ctsFn' && e.event === 'enter');
  assert.ok(fn, `expected ctsFn to be traced; got ${events.map((e) => e.method).join(', ')}`);
  assert.equal(fn.lang, 'ts', '.cts is TypeScript and must report lang "ts"');
  assert.equal(fn.args.x, 1);
});

test('.mts loads through the ESM loader and is instrumented as ts', () => {
  const { stdout, stderr, events } = run('entry-mts.mjs');

  assert.match(stdout ?? '', /mts result 3/, `stderr:\n${stderr}`);
  const fn = events.find((e) => e.method === 'mtsFn' && e.event === 'enter');
  assert.ok(fn, 'expected mtsFn to be traced');
  assert.equal(fn.lang, 'ts');
});

test('.tsx loads and is instrumented as ts', () => {
  const { stdout, stderr, events } = run('entry-tsx.mjs');

  assert.match(stdout ?? '', /tsx result 4/, `stderr:\n${stderr}`);
  const fn = events.find((e) => e.method === 'tsxFn' && e.event === 'enter');
  assert.ok(fn, 'expected tsxFn to be traced');
  assert.equal(fn.lang, 'ts');
});

test('the two hooks agree on which TypeScript extensions are supported', async () => {
  // A drift between these lists is invisible until someone happens to use the
  // missing extension, and then presents as an unrelated SyntaxError.
  const esmSource = readFileSync(join(__dirname, '../src/esm/loader.mjs'), 'utf8');
  const cjsSource = readFileSync(join(__dirname, '../src/cjs/hook.js'), 'utf8');

  for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
    assert.ok(
      esmSource.includes(`'${ext}'`),
      `ESM loader does not list ${ext}`
    );
  }
  // .cts is the only TypeScript extension that is CommonJS, so it is the only
  // one the CJS hook must know about; .mts and .ts-as-ESM never reach _compile.
  assert.ok(cjsSource.includes("'.cts'"), 'CJS hook does not list .cts');
});
