/**
 * NODE_OPTIONS is split on whitespace; the bootstrap path must survive one.
 *
 * Runs with: node --test test/test-node-options.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeOptions } from '../src/runtime/node-options.js';

const BOOT = '/Users/me/My Projects/flowtrace/bootstrap.mjs';

test('a path with a space becomes a file: URL with no whitespace', () => {
  const opts = buildNodeOptions(undefined, BOOT);
  assert.equal(opts, '--import file:///Users/me/My%20Projects/flowtrace/bootstrap.mjs --enable-source-maps');
  const flagValue = opts.split(' ')[1];
  assert.ok(!/\s/.test(flagValue));
});

test('existing options are preserved and the flag is added once', () => {
  const once = buildNodeOptions('--max-old-space-size=4096', BOOT);
  assert.ok(once.startsWith('--max-old-space-size=4096 --import file:///'));
  const twice = buildNodeOptions(once, BOOT);
  assert.equal(twice, once, 'idempotent across generations');
});
