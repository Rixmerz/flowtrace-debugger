/**
 * ESM loader regression tests.
 *
 * The TypeScript capture path was a silent no-op for two different reasons on
 * two different Node lines, and neither had a test:
 *   - Node >= 22.18 reports 'module-typescript' / 'commonjs-typescript', which
 *     the loader used to reject outright.
 *   - Node < 22.18 throws ERR_UNKNOWN_FILE_EXTENSION from nextLoad before any
 *     format exists, so the loader has to take over reading the file.
 *
 * These tests drive the load hook directly with a stubbed nextLoad, so both
 * branches are covered regardless of which Node actually runs the suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const { load } = await import('../src/esm/loader.mjs');

const TS_SOURCE = `export class Calc {
  add(a: number, b: number): number { return a + b; }
}
`;

/** Write a .ts file inside a scratch dir, optionally with a package.json. */
function scratchTs({ pkgType } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-loader-'));
  const file = join(dir, 'calc.ts');
  writeFileSync(file, TS_SOURCE, 'utf8');
  if (pkgType !== undefined) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: pkgType }), 'utf8');
  }
  return { dir, file, url: pathToFileURL(file).href };
}

function withPrefix(prefix, fn) {
  const previous = process.env.FLOWTRACE_PACKAGE_PREFIX;
  process.env.FLOWTRACE_PACKAGE_PREFIX = prefix;
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.FLOWTRACE_PACKAGE_PREFIX;
    else process.env.FLOWTRACE_PACKAGE_PREFIX = previous;
  });
}

test('accepts Node >= 22.18 native type-stripping formats', async () => {
  const { dir, file, url } = scratchTs();
  try {
    await withPrefix(file, async () => {
      const nextLoad = async () => ({ format: 'module-typescript', source: TS_SOURCE });
      const result = await load(url, {}, nextLoad);

      assert.equal(result.format, 'module', 'module-typescript must map to module');
      assert.ok(result.shortCircuit, 'loader must short-circuit after rewriting');
      assert.match(result.source, /__ft_enter/, 'source must be instrumented');
      assert.doesNotMatch(result.source, /: number/, 'types must be stripped');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recovers when nextLoad throws ERR_UNKNOWN_FILE_EXTENSION (Node < 22.18)', async () => {
  const { dir, file, url } = scratchTs({ pkgType: 'module' });
  try {
    await withPrefix(file, async () => {
      const nextLoad = async () => {
        const err = new Error('Unknown file extension ".ts"');
        err.code = 'ERR_UNKNOWN_FILE_EXTENSION';
        throw err;
      };
      const result = await load(url, {}, nextLoad);

      assert.equal(result.format, 'module', 'package.json type=module must win');
      assert.match(result.source, /__ft_enter/, 'source must be instrumented');
      assert.match(result.source, /^import /m, 'ESM output must use import');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CommonJS format emits require() with a filesystem path, not a file:// URL', async () => {
  const { dir, file, url } = scratchTs({ pkgType: 'commonjs' });
  try {
    await withPrefix(file, async () => {
      const nextLoad = async () => {
        const err = new Error('Unknown file extension ".ts"');
        err.code = 'ERR_UNKNOWN_FILE_EXTENSION';
        throw err;
      };
      const result = await load(url, {}, nextLoad);

      assert.equal(result.format, 'commonjs');
      // require() cannot resolve a file:// URL — this is the whole point.
      assert.doesNotMatch(result.source, /require\(["']file:\/\//);
      assert.match(result.source, /require\(/, 'CJS output must use require');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('.mts is module and .cts is commonjs regardless of package.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-loader-ext-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

    const mtsFile = join(dir, 'a.mts');
    writeFileSync(mtsFile, TS_SOURCE, 'utf8');
    const ctsFile = join(dir, 'b.cts');
    writeFileSync(ctsFile, TS_SOURCE, 'utf8');

    const throwing = async () => {
      const err = new Error('Unknown file extension');
      err.code = 'ERR_UNKNOWN_FILE_EXTENSION';
      throw err;
    };

    await withPrefix(dir, async () => {
      const mts = await load(pathToFileURL(mtsFile).href, {}, throwing);
      assert.equal(mts.format, 'module', '.mts must override package.json type');

      const cts = await load(pathToFileURL(ctsFile).href, {}, throwing);
      assert.equal(cts.format, 'commonjs', '.cts must be commonjs');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-TypeScript ERR_UNKNOWN_FILE_EXTENSION is not swallowed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ft-loader-other-'));
  try {
    const file = join(dir, 'data.wasm');
    writeFileSync(file, 'not really wasm', 'utf8');

    await withPrefix(dir, async () => {
      const nextLoad = async () => {
        const err = new Error('Unknown file extension ".wasm"');
        err.code = 'ERR_UNKNOWN_FILE_EXTENSION';
        throw err;
      };
      await assert.rejects(
        () => load(pathToFileURL(file).href, {}, nextLoad),
        /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/,
        'only TypeScript files may take the fallback path'
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('files outside the instrumentation prefix pass through untouched', async () => {
  const { dir, file, url } = scratchTs();
  try {
    await withPrefix('/some/other/place', async () => {
      const upstream = { format: 'module-typescript', source: TS_SOURCE };
      const result = await load(url, {}, async () => upstream);
      assert.equal(result, upstream, 'must return the upstream result as-is');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
