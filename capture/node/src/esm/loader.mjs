/**
 * ESM loader for FlowTrace v2.
 * Register with: node --import ./src/bootstrap.mjs
 * The bootstrap calls module.register() which wires this file as a loader.
 */

import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';

// Dynamic import of transform and cache so the loader module itself is lean.
// These are loaded lazily on first instrumented file.
let _transform = null;
let _cache = null;

async function getTransform() {
  if (!_transform) {
    const mod = await import('../transform/swc.js');
    _transform = mod.transform;
  }
  return _transform;
}

async function getCache() {
  if (!_cache) {
    _cache = await import('../cache/index.js');
  }
  return _cache;
}

const RUNTIME_SPECIFIER = '@flowtrace/capture-node/runtime/instrument';

/** Extensions we instrument. */
const INSTRUMENTED_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

/**
 * TypeScript extensions. Node's own resolver has no format mapping for these,
 * so delegating to nextLoad() throws ERR_UNKNOWN_FILE_EXTENSION before we ever
 * see the source — see the comment in load().
 */
const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * Returns true if the URL should be instrumented.
 */
function shouldInstrument(url) {
  if (!url.startsWith('file://')) return false;
  const path = fileURLToPath(url);
  if (path.includes('/node_modules/')) return false;

  const ext = extname(path);
  if (!INSTRUMENTED_EXTS.includes(ext)) return false;

  const prefix = process.env.FLOWTRACE_PACKAGE_PREFIX;
  if (!prefix) {
    return path.startsWith(process.cwd());
  }
  return path.includes(prefix);
}

/**
 * Read, transform and return a TypeScript module without consulting Node's
 * default loader.
 *
 * `.cts` declares CommonJS; every other TS extension declares ESM, matching
 * TypeScript's own convention.
 *
 * @param {string} url
 * @returns {Promise<{format: string, source: string, shortCircuit: true}|null>}
 *   null if the file could not be read or transformed, so the caller can fall
 *   back to Node's normal (erroring) path instead of masking the problem.
 */
async function loadTypeScript(url) {
  try {
    const filename = fileURLToPath(url);
    const source = await readFile(filename, 'utf8');
    const format = extname(filename) === '.cts' ? 'commonjs' : 'module';

    const cache = await getCache();
    const transformFn = await getTransform();

    const moduleType = format === 'commonjs' ? 'cjs' : 'esm';
    const key = cache.cacheKey(source, moduleType);
    let code = cache.cacheGet(key);
    if (!code) {
      const out = transformFn(source, {
        filename,
        moduleType,
        runtimePath: RUNTIME_SPECIFIER,
      });
      code = out.code;
      cache.cachePut(key, code, out.map);
    }

    return { format, source: code, shortCircuit: true };
  } catch (e) {
    process.stderr.write(`[flowtrace] TS load failed for ${url}: ${e.message}\n`);
    return null;
  }
}

/**
 * ESM loader load hook.
 */
export async function load(url, context, nextLoad) {
  // TypeScript must be handled BEFORE delegating. Node's default loader has no
  // format mapping for .ts/.tsx/.mts/.cts, so `await nextLoad(...)` throws
  // ERR_UNKNOWN_FILE_EXTENSION and the transform never runs. Because that throw
  // happened on line one of this hook, TypeScript was unloadable over ESM
  // entirely — which is why `lang: "ts"` had never once been emitted despite
  // being in the schema enum, the CLI and examples/golden/ts.
  //
  // So for TS we read the file ourselves and declare the format, rather than
  // asking Node to classify a file it does not recognise.
  if (shouldInstrument(url) && TS_EXTS.includes(extname(fileURLToPath(url)))) {
    const tsResult = await loadTypeScript(url);
    if (tsResult) return tsResult;
    // Fall through on failure so a transform bug degrades to Node's own error
    // rather than a silent empty module.
  }

  const result = await nextLoad(url, context);

  if (!shouldInstrument(url)) return result;

  const format = result.format;
  if (format !== 'module' && format !== 'commonjs') return result;

  let source = result.source;
  if (source == null) return result; // CJS files may have no source in the loader hook
  if (typeof source === 'string') {
    // already a string — nothing to do
  } else if (Buffer.isBuffer(source)) {
    source = source.toString('utf8');
  } else {
    // ArrayBuffer or ArrayBufferView (Uint8Array, etc.)
    source = new TextDecoder().decode(source);
  }

  try {
    const filename = fileURLToPath(url);
    const cache = await getCache();
    const transformFn = await getTransform();

    const key = cache.cacheKey(source, 'esm');
    let code = cache.cacheGet(key);
    if (!code) {
      const out = transformFn(source, {
        filename,
        moduleType: 'esm',
        runtimePath: RUNTIME_SPECIFIER,
      });
      code = out.code;
      cache.cachePut(key, code, out.map);
    }

    return { format, source: code, shortCircuit: true };
  } catch (e) {
    process.stderr.write(`[flowtrace] ESM transform error for ${url}: ${e.message}\n`);
    return result;
  }
}
