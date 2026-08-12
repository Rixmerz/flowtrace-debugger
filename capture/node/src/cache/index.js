/**
 * Disk cache for transformed source files.
 * Location: ~/.flowtrace/cache/node/<sha256>.js + <sha256>.map
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const CAPTURE_VERSION = '2.0.0-alpha.1';
const NODE_VERSION    = process.versions.node;

// Babel version (approximate — read from package.json).
let BABEL_VERSION = 'unknown';
try {
  const pkg = _require('@babel/parser/package.json');
  BABEL_VERSION = pkg.version ?? 'unknown';
} catch { /* ignore */ }

const CACHE_DIR = join(homedir(), '.flowtrace', 'cache', 'node');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Build a cache key (sha256 hex) from source + version fingerprints + every
 * transform input that ends up baked into the emitted code.
 *
 * Keying on source alone is not enough, because the transform output also
 * depends on:
 *   - `moduleType`: ESM emits an `import`, CJS emits a `require()`. Sharing a
 *     key across both can serve a `require()` into an ESM graph.
 *   - `runtimePath`: the resolved specifier is written into the injected import.
 *   - `filename`:  the `module` field of every event is derived from it, so two
 *     identical files at different paths must not share an entry.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {string} [opts.filename]
 * @param {string} [opts.moduleType]
 * @param {string} [opts.runtimePath]
 * @returns {string}
 */
export function cacheKey(source, opts = {}) {
  return createHash('sha256')
    .update(source)
    .update('\x00')
    .update(CAPTURE_VERSION)
    .update('\x00')
    .update(NODE_VERSION)
    .update('\x00')
    .update(BABEL_VERSION)
    .update('\x00')
    .update(opts.filename ?? '')
    .update('\x00')
    .update(opts.moduleType ?? '')
    .update('\x00')
    .update(opts.runtimePath ?? '')
    .digest('hex');
}

/**
 * Look up a cached transform result.
 *
 * @param {string} key - Hex sha256 from cacheKey().
 * @returns {string|null} Transformed source code or null on miss.
 */
export function cacheGet(key) {
  const path = join(CACHE_DIR, `${key}.js`);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Store a transform result.
 *
 * @param {string} key
 * @param {string} code
 * @param {object|null} map - Source map object (serialized to JSON).
 */
export function cachePut(key, code, map) {
  try {
    ensureCacheDir();
    writeFileSync(join(CACHE_DIR, `${key}.js`), code, 'utf8');
    if (map) {
      writeFileSync(join(CACHE_DIR, `${key}.map`), JSON.stringify(map), 'utf8');
    }
  } catch (e) {
    process.stderr.write(`[flowtrace] cache write failed: ${e.message}\n`);
  }
}
