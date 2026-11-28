/**
 * Bundles the behavioural trace comparison into flowtrace-cli/vendor/trace-diff/,
 * the same pattern scripts/bundle-dashboard.mjs uses for the dashboard.
 *
 * Why this exists: `flowtrace diff` and the MCP tool `trace_behavior_diff` must
 * give the same answer, so there is one implementation —
 * mcp-server/src/behavior-diff.ts. mcp-server is a sibling package that is
 * never published, and its dist/ is gitignored, so the installed CLI cannot
 * reach it. The module is pure (its only import is node:crypto), so esbuild
 * turns it into one CommonJS file with nothing to resolve at runtime.
 *
 * The output is a committed build artifact. `make check-bundle` rebuilds it
 * and fails if the result differs from what is committed; esbuild is pinned to
 * an exact version so that comparison is meaningful.
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..'); // flowtrace-cli/
const REPO = resolve(PKG, '..'); // flowtrace-debugger/
const ENTRY = join(REPO, 'mcp-server', 'src', 'behavior-diff.ts');
const OUT = join(PKG, 'vendor', 'trace-diff', 'behavior-diff.bundle.js');

if (!existsSync(ENTRY)) {
  console.error(`[bundle-diff] missing source: ${ENTRY}`);
  process.exit(1);
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  // Pinned so esbuild's "// path/to/module" comments do not depend on the
  // directory this happens to be run from — see bundle-dashboard.mjs.
  absWorkingDir: PKG,
  bundle: true,
  platform: 'node',
  // The CLI's own floor (package.json "engines"), not the repo's test floor.
  target: 'node18',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js:
      '// GENERATED FILE - DO NOT EDIT.\n' +
      '// Built from mcp-server/src/behavior-diff.ts by flowtrace-cli/scripts/bundle-diff.mjs.\n' +
      '// Run `make bundle-diff` after changing that file.\n',
  },
});
console.log(`[bundle-diff] bundled -> ${OUT.replace(PKG, '<pkg>')}`);
