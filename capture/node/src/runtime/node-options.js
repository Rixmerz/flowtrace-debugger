import { pathToFileURL } from 'node:url';

/**
 * The NODE_OPTIONS value that makes every Node process this one starts —
 * worker_threads and child processes alike — load the bootstrap too.
 *
 * NODE_OPTIONS is split on whitespace, so the bootstrap path cannot be pasted
 * in as-is: an install under "Application Support" or "My Projects" produced
 * two half-flags and every child failed to start. A file: URL has no spaces
 * (they become %20), which is what `--import` wants anyway.
 *
 * Idempotent: a value that already carries the flag is returned unchanged, so
 * a grandchild does not accumulate one `--import` per generation.
 *
 * @param {string|undefined} existing - current NODE_OPTIONS
 * @param {string} bootstrapAbsPath - absolute filesystem path of bootstrap.mjs
 * @returns {string}
 */
export function buildNodeOptions(existing, bootstrapAbsPath) {
  const flag = `--import ${pathToFileURL(bootstrapAbsPath).href}`;
  const current = existing ?? '';
  if (current.includes(flag)) return current;
  return current
    ? `${current} ${flag} --enable-source-maps`
    : `${flag} --enable-source-maps`;
}
