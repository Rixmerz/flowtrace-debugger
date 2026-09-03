/**
 * The transform cache key must change whenever the emitted code can change.
 * It once carried a hardcoded version string that was never bumped, so every
 * transform fix since 2.0.0-alpha.1 was invisible to anyone with a warm cache.
 *
 * Runs with: node --test test/test-cache.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cacheKey, CAPTURE_FINGERPRINT } from '../src/cache/index.js';

const pkg = createRequire(import.meta.url)('../package.json');

test('the fingerprint carries the package version and a hash of the transform sources', () => {
  assert.match(CAPTURE_FINGERPRINT, /^[^:]+:[0-9a-f]{64}$/);
  assert.equal(CAPTURE_FINGERPRINT.split(':')[0], pkg.version);
});

test('the key is a sha256 and differs per transform input', () => {
  const base = cacheKey('x', { filename: '/a.js', moduleType: 'cjs', runtimePath: '/r' });
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.notEqual(base, cacheKey('y', { filename: '/a.js', moduleType: 'cjs', runtimePath: '/r' }));
  assert.notEqual(base, cacheKey('x', { filename: '/b.js', moduleType: 'cjs', runtimePath: '/r' }));
  assert.notEqual(base, cacheKey('x', { filename: '/a.js', moduleType: 'esm', runtimePath: '/r' }));
  assert.notEqual(base, cacheKey('x', { filename: '/a.js', moduleType: 'cjs', runtimePath: '/s' }));
  assert.equal(base, cacheKey('x', { filename: '/a.js', moduleType: 'cjs', runtimePath: '/r' }));
});
