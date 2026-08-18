/**
 * Both ESM import styles of a patched builtin must see the patch.
 *
 * A builtin's ESM facade snapshots its named exports from the CJS exports when
 * the facade is first created. Reaching node:http with a static `import` inside
 * the runtime creates that facade before the patch lands, so an application
 * doing `import { request } from 'node:http'` silently gets the ORIGINAL
 * function while one doing `import http from 'node:http'` gets the patched one.
 *
 * Two import styles behaving differently is worse than not patching at all: the
 * user has no way to tell which one they are in, and the missing propagation is
 * invisible — the trace simply splits. Hence createRequire in propagate.js and
 * subprocess.js, and hence this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = join(HERE, '..', 'src', 'bootstrap.mjs');
const PROBE = join(HERE, 'fixtures', 'facade-probe.mjs');

test('named and default imports of node:http both observe the patch', () => {
  const res = spawnSync(process.execPath, ['--import', `file://${BOOTSTRAP}`, PROBE], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.equal(res.status, 0, `probe failed: ${res.stderr}`);

  const seen = JSON.parse(res.stdout.trim());
  assert.equal(seen.default, true, 'default import is patched');
  assert.equal(seen.named, true,
    'named import is patched — a static ESM import of the builtin would break this');
});
