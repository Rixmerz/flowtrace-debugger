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
 * Build a cache key (sha256 hex) from source + version fingerprints.
 *
 * @param {string} source
 * @returns {string}
 */
export function cacheKey(source) {
  return createHash('sha256')
    .update(source)
    .update('\x00')
    .update(CAPTURE_VERSION)
    .update('\x00')
    .update(NODE_VERSION)
    .update('\x00')
    .update(BABEL_VERSION)
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
