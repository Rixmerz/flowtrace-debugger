/**
 * CJS hook — patches Module.prototype._compile to intercept CommonJS module
 * loading and inject FlowTrace instrumentation via the AST transform.
 *
 * Install by calling install() once at startup (bootstrap.mjs does this).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { cacheKey, cacheGet, cachePut } from '../cache/index.js';
import { transform } from '../transform/swc.js';

const _require = createRequire(import.meta.url);
const Module   = _require('module');

// Absolute path to the runtime instrument module (CJS require path).
// When the CJS hook rewrites a file it prepends a require() pointing here.
// We use a file:// URL resolved relative to this file so it works regardless
// of whether capture-node is installed as a package or used from source.
const RUNTIME_PATH = fileURLToPath(new URL('../runtime/instrument.js', import.meta.url));

/**
 * Returns true if the given filename should be instrumented.
 * Filtering is driven by FLOWTRACE_PACKAGE_PREFIX env var:
 *   - If the env var is not set, instrument all non-node_modules files under cwd.
 *   - If it is set, instrument only files whose path includes the prefix.
 *   - node_modules is always excluded.
 *
 * @param {string} filename
 * @returns {boolean}
 */
/**
 * Extensions this hook instruments.
 *
 * `.cts` is CommonJS TypeScript, and its omission was a real gap rather than a
 * cosmetic one: Node resolves `require('./x.cts')` and hands the source to
 * Module._compile, but has no type stripping of its own, so it died on the first
 * type annotation. Because the extension was not listed here, FlowTrace declined
 * to intercept and the file was unloadable. Listing it routes the source through
 * the transform, which strips types via swc — so adding it both instruments the
 * file and makes it loadable at all.
 *
 * `.mjs` and `.mts` are always ESM and never reach Module._compile; they are
 * handled by src/esm/loader.mjs. `.mjs` is kept here only because removing a
 * harmless entry is not worth the churn.
 */
const INSTRUMENTED_EXTS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.cts'];

function shouldInstrument(filename) {
  if (filename.includes('/node_modules/')) return false;
  if (!INSTRUMENTED_EXTS.includes(extname(filename))) return false;

  const prefix = process.env.FLOWTRACE_PACKAGE_PREFIX;
  if (!prefix) {
    // Default: only instrument files under cwd.
    return filename.startsWith(process.cwd());
  }
  return filename.includes(prefix);
}

/**
 * Install the CJS hook.  Idempotent — subsequent calls are no-ops.
 */
export function install() {
  if (Module.prototype._flowtrace_installed) return;
  Module.prototype._flowtrace_installed = true;

  const originalCompile = Module.prototype._compile;

  Module.prototype._compile = function flowtrace_compile(content, filename) {
    if (!shouldInstrument(filename)) {
      return originalCompile.call(this, content, filename);
    }

    let transformed;
    try {
      const key = cacheKey(content, 'cjs');
      let code = cacheGet(key);
      if (!code) {
        const result = transform(content, {
          filename,
          moduleType: 'cjs',
          runtimePath: RUNTIME_PATH,
        });
        code = result.code;
        if (result.cacheable !== false) cachePut(key, code, result.map);
      }
      transformed = code;
    } catch (e) {
      process.stderr.write(`[flowtrace] transform error for ${filename}: ${e.message}\n`);
      transformed = content;
    }

    return originalCompile.call(this, transformed, filename);
  };
}
