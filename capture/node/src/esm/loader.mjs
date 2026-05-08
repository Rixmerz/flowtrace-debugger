/**
 * ESM loader for FlowTrace v2.
 * Register with: node --import ./src/bootstrap.mjs
 * The bootstrap calls module.register() which wires this file as a loader.
 */

import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';

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

/**
 * Returns true if the URL should be instrumented.
 */
function shouldInstrument(url) {
  if (!url.startsWith('file://')) return false;
  const path = fileURLToPath(url);
  if (path.includes('/node_modules/')) return false;

  const ext = extname(path);
  if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext)) return false;

  const prefix = process.env.FLOWTRACE_PACKAGE_PREFIX;
  if (!prefix) {
    return path.startsWith(process.cwd());
  }
  return path.includes(prefix);
}

/**
 * ESM loader load hook.
 */
export async function load(url, context, nextLoad) {
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

    const key = cache.cacheKey(source);
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
