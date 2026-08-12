/**
 * ESM loader for FlowTrace v2.
 * Register with: node --import ./src/bootstrap.mjs
 * The bootstrap calls module.register() which wires this file as a loader.
 */

import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { readFileSync } from 'node:fs';

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

/** Same module as a filesystem path, for the require() form. */
const RUNTIME_PATH = fileURLToPath(RUNTIME_SPECIFIER);

/** Node's native type-stripping formats -> the plain format swc output maps to. */
const TS_FORMATS = {
  'module-typescript': 'module',
  'commonjs-typescript': 'commonjs',
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

function isTypeScript(path) {
  return TS_EXTENSIONS.includes(extname(path));
}

/**
 * Module format for a TypeScript file that Node itself refused to load
 * (Node < 22.18, no native type stripping, ERR_UNKNOWN_FILE_EXTENSION).
 *
 * Always 'module', deliberately — this is NOT Node's nearest-package.json rule.
 *
 * Applying that rule first looked more correct, but a repo whose root
 * package.json has no "type" resolves to 'commonjs', and translating our
 * rewritten file as CJS *inside the ESM pipeline* then fails with
 * ERR_VM_MODULE_LINK_FAILURE ("request for './context.js' is not in cache"):
 * the injected `require()` points at runtime/instrument.js, which is ESM, and
 * its own imports are not in the ESM graph at that point. Emitting ESM keeps
 * the injected import and the helper on the same module system.
 *
 * Known limitation: a .ts/.cts file written in CommonJS syntax (module.exports)
 * is not supported on Node < 22.18. It was already broken before this — just
 * with a different error — and Node >= 22.18 handles it natively.
 */
function fallbackFormat() {
  return 'module';
}

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
  const instrumenting = shouldInstrument(url);

  let result = null;
  try {
    result = await nextLoad(url, context);
  } catch (e) {
    // Node < 22.18 has no native type stripping and rejects .ts outright with
    // ERR_UNKNOWN_FILE_EXTENSION — before assigning any format, so there is
    // nothing for us to rewrite unless we take over loading the file. Without
    // this branch the TypeScript capture is dead on the whole Node 20 line.
    const canRecover =
      e?.code === 'ERR_UNKNOWN_FILE_EXTENSION' && instrumenting && isTypeScript(fileURLToPath(url));
    if (!canRecover) throw e;
  }

  if (!instrumenting) return result;

  let format;
  let source;

  if (result === null) {
    // TypeScript fallback path: we own reading and typing the module.
    format = fallbackFormat();
    source = readFileSync(fileURLToPath(url), 'utf8');
  } else {
    // Node >= 22.18 strips TypeScript natively and reports the source format as
    // 'module-typescript' / 'commonjs-typescript'. Rejecting those made the whole
    // TS capture path a silent no-op on modern Node: zero events, zero errors.
    // swc already strips the types for us, so the emitted code is plain JS and we
    // hand Node back the corresponding non-TS format.
    format = TS_FORMATS[result.format] ?? result.format;
    if (format !== 'module' && format !== 'commonjs') return result;

    source = result.source;
    if (source == null) return result; // CJS files may have no source in the loader hook
    if (typeof source === 'string') {
      // already a string — nothing to do
    } else if (Buffer.isBuffer(source)) {
      source = source.toString('utf8');
    } else {
      // ArrayBuffer or ArrayBufferView (Uint8Array, etc.)
      source = new TextDecoder().decode(source);
    }
  }

  // Derive the transform's module type from the format actually being emitted.
  // Hardcoding 'esm' here injected an `import` statement into files Node was
  // about to evaluate as CommonJS.
  const moduleType = format === 'commonjs' ? 'cjs' : 'esm';

  // The CJS branch of the transform emits `require(runtimePath)`, which cannot
  // take a file:// URL — it needs a filesystem path. Only the ESM branch's
  // `import` accepts the URL form.
  const runtimePath = moduleType === 'cjs' ? RUNTIME_PATH : RUNTIME_SPECIFIER;

  try {
    const filename = fileURLToPath(url);
    const cache = await getCache();
    const transformFn = await getTransform();

    const key = cache.cacheKey(source, { filename, moduleType, runtimePath });
    let code = cache.cacheGet(key);
    if (!code) {
      const out = transformFn(source, { filename, moduleType, runtimePath });
      code = out.code;
      cache.cachePut(key, code, out.map);
    }

    return { format, source: code, shortCircuit: true };
  } catch (e) {
    process.stderr.write(`[flowtrace] ESM transform error for ${url}: ${e.message}\n`);
    // On the TypeScript fallback path there is no upstream result to fall back
    // to — Node already refused the file, so returning null would surface as a
    // confusing loader error instead of the real cause.
    if (result === null) throw e;
    return result;
  }
}
