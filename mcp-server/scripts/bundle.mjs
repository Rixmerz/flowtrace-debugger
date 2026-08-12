/**
 * Bundles the MCP server into a single self-contained file inside the plugin.
 *
 * Why this exists at all: a Claude Code plugin is installed by copying the
 * plugin directory. There is no install hook, so no `npm install` and no `tsc`
 * ever run on the user's machine. Anything the plugin's .mcp.json points at
 * must therefore be (a) committed to git, (b) inside CLAUDE_PLUGIN_ROOT, and
 * (c) runnable by a bare `node` with no node_modules beside it.
 *
 * `tsc -p .` satisfies none of those: dist/ is gitignored, it emits a module
 * graph rather than one file, and the output still requires @modelcontextprotocol/sdk
 * and zod to be resolvable at runtime. Hence esbuild with --bundle, which
 * inlines every dependency.
 *
 * The output is a committed build artifact, which is normally a smell — it can
 * silently go stale against the source it was built from. The `mcp-bundle-current`
 * CI job is the guard: it rebuilds and fails if the result differs from what is
 * committed. esbuild is pinned to an exact version so that comparison is
 * meaningful; a caret range would make the bundle differ on a patch release and
 * turn the guard into noise.
 */
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const OUT = resolve(PKG, '..', 'plugin', 'mcp', 'server.bundle.js');

await build({
  entryPoints: [join(PKG, 'src', 'server.ts')],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  // Node 20 is the oldest runtime the repo tests against (see the CI matrix).
  target: 'node20',
  // The source compiles as CommonJS (no "type": "module" in package.json), and
  // CJS avoids the ESM/CJS interop hazards of the bundled SDK.
  format: 'cjs',
  // Keep it readable-ish: this file lands in a git diff on every real change,
  // and a reviewer should be able to tell a dependency bump from a logic change.
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js:
      '// GENERATED FILE - DO NOT EDIT.\n' +
      '// Built from mcp-server/src by mcp-server/scripts/bundle.mjs.\n' +
      '// Run `make bundle-mcp` after changing anything under mcp-server/src.\n',
  },
});

console.log(`bundled -> ${OUT}`);
