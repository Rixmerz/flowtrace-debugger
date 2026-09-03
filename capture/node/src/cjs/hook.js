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

/** FlowTrace's own source root — never instrumented. See esm/loader.mjs. */
const SELF_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Absolute path to the runtime instrument module (CJS require path).
// When the CJS hook rewrites a file it prepends a require() pointing here.
// We use a file:// URL resolved relative to this file so it works regardless
// of whether capture-node is installed as a package or used from source.
const RUNTIME_PATH = fileURLToPath(new URL('../runtime/instrument.js', import.meta.url));

/** Same list as esm/loader.mjs — the two hooks used to disagree on .mts/.cts. */
const INSTRUMENTED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.mts', '.cts']);
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;

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
function shouldInstrument(filename) {
  // Either separator: a Windows path never contains '/node_modules/', and a
  // check that only knew the POSIX form instrumented every dependency there.
  if (NODE_MODULES_RE.test(filename)) return false;
  // Never instrument FlowTrace's own runtime — see SELF_ROOT in esm/loader.mjs
  // for why '/node_modules/' alone was not enough.
  if (filename.startsWith(SELF_ROOT)) return false;
  if (!INSTRUMENTED_EXTENSIONS.has(extname(filename))) return false;

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
      const key = cacheKey(content, {
        filename,
        moduleType: 'cjs',
        runtimePath: RUNTIME_PATH,
      });
      let code = cacheGet(key);
      if (!code) {
        const result = transform(content, {
          filename,
          moduleType: 'cjs',
          runtimePath: RUNTIME_PATH,
        });
        code = result.code;
        cachePut(key, code, result.map);
      }
      transformed = code;
    } catch (e) {
      process.stderr.write(`[flowtrace] transform error for ${filename}: ${e.message}\n`);
      transformed = content;
    }

    return originalCompile.call(this, transformed, filename);
  };
}
