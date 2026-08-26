/**
 * Bundles flowtrace-dashboard's server into flowtrace-cli/vendor/dashboard/,
 * the same pattern mcp-server/scripts/bundle.mjs uses for the MCP server.
 *
 * Why this exists at all: flowtrace-dashboard is a *sibling* package in the
 * monorepo, not nested under flowtrace-cli/, and flowtrace-cli's own
 * package.json `files` field never listed it. Installing the packed tarball
 * and running `flowtrace analyze` printed "No se encontro el dashboard" —
 * there was nothing to find. Its dependencies (express, cors, multer, ajv)
 * are pure JS, so esbuild --bundle inlines every one of them into a single
 * file with no node_modules to vendor.
 *
 * Layout, and why it is not arbitrary: the bundle lands at
 * vendor/dashboard/server/server.bundle.js — same nesting depth as the
 * source's flowtrace-dashboard/server/server.js — because server.js resolves
 * its static assets as `path.join(__dirname, '../public')`. esbuild inlines
 * every required module into one file, so every module's __dirname collapses
 * to that one file's directory; keeping the bundle at the same depth as the
 * original server.js means that relative path still lands on `public/`
 * unpatched. `public/` is copied alongside it for the same reason: it is
 * static assets, not code, so there is nothing for esbuild to bundle.
 *
 * schema/flowtrace-v2.json is copied too, and lands at flowtrace-cli/schema/,
 * not under vendor/dashboard/ — server/api/collect.js reads it at require
 * time via `path.resolve(__dirname, '../../../schema/flowtrace-v2.json')`,
 * three levels up from its *original* location (server/api/, one level
 * deeper than server.js). Bundling collapses __dirname to the bundle's own
 * directory, which sits at server.js's shallower depth, so those same three
 * "up" segments land one level higher than in the source tree — at
 * flowtrace-cli/ itself. Without this file the bundled server throws
 * ENOENT on startup, in every request path, because collect.js reads it at
 * module load, not lazily.
 *
 * The output is a committed build artifact, which is normally a smell — it
 * can silently go stale against the source it was built from. The
 * `check-bundle` Makefile target is the guard: it rebuilds and fails if the
 * result differs from what is committed. esbuild is pinned to an exact
 * version (see mcp-server/package.json) so that comparison is meaningful.
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..'); // flowtrace-cli/
const REPO = resolve(PKG, '..'); // flowtrace-debugger/
const DASHBOARD = join(REPO, 'flowtrace-dashboard');

const VENDOR_DASHBOARD = join(PKG, 'vendor', 'dashboard');
const OUT = join(VENDOR_DASHBOARD, 'server', 'server.bundle.js');

function fail(msg) {
  console.error(`[bundle-dashboard] ${msg}`);
  process.exit(1);
}

if (!existsSync(join(DASHBOARD, 'server', 'server.js'))) {
  fail(`missing flowtrace-dashboard checkout: ${DASHBOARD}`);
}

await build({
  entryPoints: [join(DASHBOARD, 'server', 'server.js')],
  outfile: OUT,
  // esbuild's inlined "// path/to/module.js" comments are relative to the
  // working directory at build time, not to entryPoints. Pinning it here
  // keeps the output byte-identical whether this runs as `node
  // scripts/bundle-dashboard.mjs` (cwd flowtrace-cli/) or via `make
  // bundle-dashboard` (also cwd flowtrace-cli/, but this removes the
  // dependency on that happening to match) — otherwise `check-bundle`'s
  // git-diff guard flags a rebuild as stale even when nothing changed.
  absWorkingDir: PKG,
  bundle: true,
  platform: 'node',
  // Node 20 is the oldest runtime the repo tests against (see the CI matrix).
  target: 'node20',
  // The source compiles as CommonJS (no "type": "module" in package.json).
  format: 'cjs',
  // Keep it readable-ish: this file lands in a git diff on every real change,
  // and a reviewer should be able to tell a dependency bump from a logic change.
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js:
      '// GENERATED FILE - DO NOT EDIT.\n' +
      '// Built from flowtrace-dashboard/server by flowtrace-cli/scripts/bundle-dashboard.mjs.\n' +
      '// Run `make bundle-dashboard` after changing anything under flowtrace-dashboard/server.\n',
  },
});
console.log(`[bundle-dashboard] bundled -> ${OUT.replace(PKG, '<pkg>')}`);

// Static assets: copy, do not bundle.
const publicOut = join(VENDOR_DASHBOARD, 'public');
rmSync(publicOut, { recursive: true, force: true });
mkdirSync(publicOut, { recursive: true });
cpSync(join(DASHBOARD, 'public'), publicOut, { recursive: true });
console.log(`[bundle-dashboard] copied public -> ${publicOut.replace(PKG, '<pkg>')}`);

// Schema: see the file-header comment for why this lands here and not under
// vendor/dashboard/.
const schemaOut = join(PKG, 'schema', 'flowtrace-v2.json');
mkdirSync(dirname(schemaOut), { recursive: true });
cpSync(join(REPO, 'schema', 'flowtrace-v2.json'), schemaOut);
console.log(`[bundle-dashboard] copied schema -> ${schemaOut.replace(PKG, '<pkg>')}`);
