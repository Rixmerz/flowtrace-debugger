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

// Absolute file URL to the runtime helpers, mirroring what the CJS hook does.
// A bare specifier ('@flowtrace/capture-node/runtime/instrument') only resolves
// when the traced app happens to have the package in its own node_modules —
// which a traced app generally does not. Using the absolute URL makes the
// injected import resolvable from anywhere on disk.
const RUNTIME_SPECIFIER = new URL('../runtime/instrument.js', import.meta.url).href;

/** Node's native type-stripping formats -> the plain format swc output maps to. */
const TS_FORMATS = {
  'module-typescript': 'module',
  'commonjs-typescript': 'commonjs',
};

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

  // Node >= 22.18 strips TypeScript natively and reports the source format as
  // 'module-typescript' / 'commonjs-typescript'. Rejecting those made the whole
  // TS capture path a silent no-op on modern Node: zero events, zero errors.
  // swc already strips the types for us, so the emitted code is plain JS and we
  // hand Node back the corresponding non-TS format.
  const format = TS_FORMATS[result.format] ?? result.format;
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

    const key = cache.cacheKey(source, {
      filename,
      moduleType: 'esm',
      runtimePath: RUNTIME_SPECIFIER,
    });
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
