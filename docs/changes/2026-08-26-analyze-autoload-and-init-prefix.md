# `flowtrace analyze` auto-load + `init`'s duplicated prefix-detection bug

flow: flowtrace-analyze-autoload

## Why

Two independent items, both requested directly by the user after live
revalidation of the two prior fixes against the real installed plugin.

1. **UX**: `flowtrace analyze` opens a bare `http://localhost:PORT` tab and
   makes the user manually upload the JSONL, even though it already knows
   the file path. Investigated: the mechanism to skip that already exists
   and is already wired end-to-end elsewhere in this same codebase —
   `flowtrace-dashboard/public/index.html` reads `?analysis=<id>` on load and
   fetches `GET /api/analyze/:id`; `flowtrace-dashboard/mcp-tools.js`'s
   `openInDashboard()` (the MCP-agent code path) already POSTs to
   `/api/analyze-file` and opens `?analysis=<id>`. `analyze.js` (the actual
   `flowtrace analyze` CLI command) is the only caller that doesn't use it —
   it sets a `FLOWTRACE_FILE` env var into the child process that is never
   read anywhere in the repo (confirmed dead in the prior review), and opens
   the bare URL regardless.

2. **Bug**: live-reproduced after the prior "AC4 fixed" claim — `flowtrace
   init` still prints the wrong Python prefix for the exact case that
   motivated the original fix (distribution name `api-businessrules-over-
   validator`, import name `over_validator` under `src/`). Root cause:
   `flowtrace init` and `flowtrace run` call two **separate, independently
   implemented** prefix-detection functions.
   `flowtrace-cli/lib/commands/run.js`'s `detectPythonPrefix()` got the fix
   (hatch/setuptools config → `src/` layout → root layout → distribution-name
   fallback). `flowtrace-cli/lib/detect.js`'s `_pythonPrefix()` — called by
   `init.js` — is the original, never-touched, distribution-name-only
   implementation. None of the tests written for the original fix exercised
   `init`, only `run`, so this gap shipped unnoticed.

## In scope, each with an acceptance criterion

### AC1 — `flowtrace analyze` opens the trace already loaded
Before opening the browser (both the freshly-spawned-server path and the
already-running-server-reused path, once each has passed its `/health`
check), POST `{filePath: target}` to `/api/analyze-file` on the confirmed-live
server, take the returned `analysisId`, and open
`http://localhost:PORT?analysis=<analysisId>` instead of the bare URL —
mirroring `mcp-tools.js`'s already-existing, already-correct pattern exactly.
If the POST fails (malformed JSONL, network hiccup), fall back to opening the
bare URL with a warning on stderr — a failed pre-load must never block
opening the dashboard at all.
Remove the `FLOWTRACE_FILE` env var from the child spawn — it becomes fully
redundant once the file is loaded via the API call, and it was already dead
code before this change.
AC: `flowtrace analyze <jsonl>` opens (or, in a headless test, `curl`s) a URL
containing `?analysis=`; `GET /api/analyze/<that id>` returns the real
analyzed results for that specific file, not an empty dashboard. Verified on
both the first-spawn path and the already-running-reuse path.

### AC2 — one prefix-detection implementation, not two
Extract `detectPythonPrefix()` (and its `_tomlArrayInSection`/
`_singlePackageDir` helpers) out of `run.js` into a shared module, and make
both `run.js` and `lib/detect.js`'s `_pythonPrefix()` call that single
implementation — not just copy the fixed logic into `detect.js` a second
time, which would leave the same two-implementations footgun for the next
change to drift apart again.
AC: `flowtrace init` on a project shaped like the real motivating case
(`pyproject.toml` `[project].name = "api-businessrules-over-validator"`,
package at `src/over_validator/__init__.py`, no explicit hatch/setuptools
package config) detects `over_validator`, not the distribution name — the
exact repro that was live-tested and failed before this fix. Structurally:
grep confirms exactly one function body implementing the detection algorithm,
imported by both call sites.

### AC3 — the mcp-server fix (and the two before it) actually reach installed
### plugin users; the CLI fix gets correct versioning for when it's published
`claude plugin update` compares only `plugin.json`'s `version` field against
the marketplace's — it does not diff git content. Both prior fixes shipped
with `plugin.json` still at `2.1.0`, so `claude plugin update` reported
"already at the latest version" while serving the stale, pre-fix bundle; only
an uninstall+reinstall picked up the real content (verified live this
session). Bump `plugin/.claude-plugin/plugin.json`'s `version` to `2.1.1`.

**Correction made during review**: `plugin.json`'s version only gates the
Claude Code plugin, which ships `mcp-server/` — it has no connection to the
`flowtrace-cli` npm package, where AC1 and AC2 actually live
(`grep -c "detectPythonPrefix\|analyze-file" plugin/mcp/server.bundle.js` is
`0`). Bumping only `plugin.json` would have left AC1/AC2 without any version
bump at all. Also bumped: `flowtrace-cli/package.json`'s `version` and
`.claude-plugin/marketplace.json`'s `metadata.version`, both to `2.1.1`, for
correct versioning hygiene — `flowtrace-cli` was not published to npm as of
this session, so this has no live auto-update effect today; it matters the
moment it is published (a publish is planned immediately after this change
lands).
AC: after this change is pushed, `claude plugin marketplace update rixmerz &&
claude plugin update flowtrace` (no uninstall) actually replaces the cached
`mcp/server.bundle.js` with the current content — checked by hash, the same
way the mcp-server staleness was originally proven. `flowtrace-cli/package.json`
and `.claude-plugin/marketplace.json` both read `2.1.1`.

## Out of scope
- A CI/process guard that forces a version bump whenever `plugin/` changes
  (the `check-bundle`-style guard that would prevent this class of bug from
  recurring) — real hardening, but a separate, larger decision than "bump the
  number now." Noted for a future change, not built here.
- Any dashboard UI/UX beyond the auto-load itself (e.g. showing a "loading
  the trace you just captured" state) — not requested.

## Approach
AC1 and AC2 are isolated, unrelated code paths — no shared risk. AC3 is a
one-line version bump. One test per AC, extending the existing suites this
repo already has (`flowtrace-cli/test/`, `flowtrace-dashboard/test/`).

## Verification
- `flowtrace-cli/test/test-analyze-dedup.js`-style real subprocess test:
  `flowtrace analyze` against a real JSONL, curl the opened URL's analysis id
- `cd flowtrace-cli && npm test`
- `cd flowtrace-dashboard && npm test`
- `make check-bundle`
- live: `claude plugin marketplace update rixmerz && claude plugin update
  flowtrace`, hash-compare the cached bundle against `origin/main`
