# `flowtrace analyze` packaging + tab-dedup fix

flow: flowtrace-analyze-fix

## Why

Live report while dogfooding: `flowtrace analyze` opened repeated
`http://localhost:8765/` browser tabs, some landing on
`ERR_CONNECTION_REFUSED`. Follow-up to the earlier audit, which flagged
`analyze` as broken outside a monorepo checkout (out of scope then, in scope
now).

Root cause chain, each independently verified:

1. **The dashboard is never shipped.** `flowtrace-cli/package.json`'s `files`
   field is `["bin","lib","vendor","README.md"]` — `flowtrace-dashboard/` is
   never included in the published/packed tarball (confirmed earlier this
   session: installing the real `.tgz` and running `flowtrace analyze`
   printed `Error: No se encontro el dashboard`). It's a *sibling* package in
   the monorepo, not nested under `flowtrace-cli/`, and `scripts/vendor.mjs`
   (which vendors the Java/Node/Python capture runtimes into `vendor/`) never
   touches it.
2. **`analyze.js`'s path resolution only works by the coincidence of the
   monorepo's own directory depth.** `repoRoot()` = `path.resolve(__dirname,
   '..','..','..')` from `lib/commands/` — 3 levels up lands on
   `flowtrace-debugger/` only because `flowtrace-cli/` happens to sit one
   level inside it. There is no path, vendored or otherwise, that would
   resolve correctly for an installed package once (1) is fixed to actually
   ship *something*.
3. **No dedup before spawning.** `analyze.js` spawns a brand-new
   `node server.js` + opens a brand-new browser tab on every invocation, with
   no check for whether a dashboard is already serving. Contrast:
   `flowtrace-dashboard/mcp-tools.js`'s own `startDashboard()` already does
   the right thing (`GET /health` first, only spawn if that fails) — `analyze.js`
   just doesn't use that pattern.
4. **The server can't tell you it's already running.** `server.js`'s
   `app.listen(PORT, cb)` has no `.on('error', ...)` handler. Node's default
   behavior for an unhandled `'error'` event is to throw — so a second
   `node server.js` on an occupied port crashes with a raw uncaught-exception
   stack trace instead of a clean "already in use" message.

## In scope, each with an acceptance criterion

### AC1 — `flowtrace analyze` works from an installed package, not just the checkout
Bundle `flowtrace-dashboard`'s server (`server.js` + `server/api/*.js`, whose
only deps are pure-JS: `express`, `cors`, `multer`, `ajv`) via esbuild into a
single file, the same pattern `mcp-server/scripts/bundle.mjs` already uses for
the MCP server — inlines dependencies, no `node_modules` to vendor. Copy the
static `public/` assets alongside it. Ship both under
`flowtrace-cli/vendor/dashboard/` (add to `package.json`'s `files`, wire into
the existing `vendor`/`prepack` step).
AC: `npm pack` (or the repo's existing pack step) produces a tarball; installed
into a clean temp directory with **no flowtrace-debugger checkout anywhere on
disk**, `flowtrace analyze <jsonl>` starts the dashboard and `GET
http://localhost:<port>/health` returns 200.

### AC2 — path resolution has one strategy, tested for both layouts
Replace `repoRoot()`'s hardcoded `'..','..','..'` with a resolver that checks
`vendor/dashboard/server.bundle.js` relative to the installed package first,
falling back to the monorepo-relative `../../flowtrace-dashboard/server/server.js`
for local dev (so `make bundle-mcp`-style contributors don't need a vendor
build just to test `analyze` against source). No behavior depends on which
directory depth happens to be true today.
AC: a unit test exercises both branches (mock/point at each layout) and
asserts the correct path is chosen; the AC1 pack-and-run test is the
integration-level proof for the installed-package branch.

### AC3 — no redundant server, no redundant tab
Before spawning, `analyze.js` probes `GET http://localhost:<port>/health`
(short timeout, mirroring `flowtrace-dashboard/mcp-tools.js`'s existing
`startDashboard()`). If a FlowTrace dashboard is already listening there,
skip spawning a new server process entirely and open the browser only once
against the confirmed-live server — never before a successful health check.
AC: invoke `flowtrace analyze a.jsonl`, then (while it's still running)
`flowtrace analyze b.jsonl` — exactly one dashboard server process exists
afterward (checked by PID/port ownership), and the second invocation's
browser-open only fires after its own `/health` probe succeeds (no
speculative open-before-verify, which is exactly the sequence that produces
an `ERR_CONNECTION_REFUSED` tab).

### AC4 — the dashboard server fails loud and clean, not with a stack trace
`flowtrace-dashboard/server/server.js`'s `app.listen()` gets an
`.on('error', ...)` handler: on `EADDRINUSE`, print one clear line (something
else — quite possibly another `flowtrace analyze` — already owns this port;
set `FLOWTRACE_DASHBOARD_PORT` to use another one) and exit non-zero. No
unhandled-exception stack trace, no orphaned process left holding stdio open.
AC: start two `node server.js` back to back on the same port — the second
prints the one-line message and exits; `ps` shows no leftover process from
the failed attempt.

## Out of scope
- Re-skinning or feature work on the dashboard UI itself.
- The MCP-driven path (`flowtrace-dashboard/mcp-tools.js` /
  `openInDashboard`) — it already health-checks before spawning; not touched.
- Publishing `@rixmerz/flowtrace` to the npm registry (still not published,
  confirmed earlier this session) — AC1's proof is a local pack+install, not
  a registry round-trip.

## Approach
Mirror the MCP server's existing bundle pattern exactly (esbuild, single
file, committed artifact, `make`-driven rebuild + a `check-bundle`-style CI
guard so this can't silently go stale again the way `server.bundle.js` did
twice during the prior audit fix). One test per AC. No new runtime
dependencies beyond esbuild, which is already a devDependency in this repo.

## Verification
- `cd flowtrace-dashboard && npm test` (existing analyzer tests, unaffected)
- new: pack `flowtrace-cli`, install into a scratch dir, run `flowtrace
  analyze` against a real JSONL, curl `/health`
- `cd flowtrace-cli && npm test`
