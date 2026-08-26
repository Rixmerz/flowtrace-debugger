# Dashboard analyzer/frontend contract rewrite + browser tab dedup

flow: flowtrace-dashboard-contract

## Why

User used the dashboard for the first time ever with real data (it was
completely broken/unreachable until today's three earlier fixes) and found
it unusable: every duration metric shows `NaN`/`NaN%`, the Time Distribution
chart is empty, and every `flowtrace analyze` invocation opens another
browser tab even when a dashboard is already running.

Investigated exhaustively (grep across the whole repo for every reader of
`PerformanceAnalyzer`'s output — livespec MCP was unavailable this session,
so this was manual, not call-graph-verified, but exhaustive by construction:
searched every field name across every `.js`/`.mjs`/`.html` file outside
`node_modules`/`vendor`).

**Root cause**: `flowtrace-dashboard/analyzer/metrics/performance.js` (its own
header comment: "v2 Performance Analyzer") was rewritten at some point to key
off `duration_ns` and return everything as raw-nanosecond, `_ns`-suffixed
fields (`avg_ns`, `total_ns`, `p95_ns`, `p99_ns`, `totalErrors`). Every real
consumer — three independent ones — was never updated and still reads the
older, ms-based, differently-named shape:

| Consumer | Reads (doesn't exist on current analyzer output) |
|---|---|
| `flowtrace-dashboard/public/js/components/metrics-panel.js:23,30` | `summary.avgDuration`, `summary.totalExceptions` |
| `flowtrace-dashboard/public/js/components/table-renderer.js:70-136` | `method.avgDuration/.p95/.p99/.totalTime`; `bottleneck.avgDuration/.totalTime`; `error.callCount/.exceptions` |
| `flowtrace-dashboard/mcp-tools.js:83,85` (the MCP-agent path) | `summary.avgDuration`, `summary.totalExceptions` |
| `flowtrace-dashboard/cli.js:59-136` (standalone `node cli.js analyze\|slow\|bottlenecks\|errors`) | `summary.avgDuration/.totalExceptions/.totalTime`; `method.avgDuration/.p95/.p99/.totalTime`; `bottleneck.avgDuration/.totalTime/.impactScore` |

Separately, `calculateTimeDistribution()` returns a **per-method** breakdown
(`{total_ns, distribution: [{name, class, method, total_ns, percentage}]}`),
but `chart-renderer.js:16-36` expects a **duration-range histogram**
(`distribution.ranges` → `.map(r => r.range/.count/.percentage)`, rendered
as a bar chart explicitly titled "Method Call Duration Distribution" with
x-axis "Duration Range"). `distribution.ranges` is `undefined`, `.map()` on
`undefined` throws, and the chart never renders — that's the empty panel.

The only thing that currently asserts the `_ns`-suffixed field names is the
analyzer's own test (`flowtrace-dashboard/test/test-analyzer.js:32-33`) — not
an external consumer, its own internal contract check.

**No backward compatibility needed**: this dashboard has never worked
end-to-end with real data before today (packaging was broken, then the CLI
never called it) — there is no installed base depending on the current
broken shape. Per direction: delete the dead `_ns` fields outright, do not
dual-emit for compatibility, single clean contract.

Separately: `flowtrace-cli/lib/commands/analyze.js`'s reuse path (dashboard
already running) still calls `openBrowser()` unconditionally on every
invocation (line ~210-212) — the AC3 dedup fix in a prior flow stopped a
second *server process* from spawning but never addressed a second *browser
tab* opening, which was the user's original complaint from the very start
of this session and was never actually fixed.

## In scope, each with an acceptance criterion

### AC1 — one canonical `PerformanceAnalyzer` contract, ms-based, matching
### what the three real consumers already agree on
Rewrite `flowtrace-dashboard/analyzer/metrics/performance.js` to return,
converting from `duration_ns` to milliseconds at the analyzer boundary
(divide by 1e6) and delete the `_ns`-suffixed fields entirely (no dual
emission):
- `getSummary()`: `{totalCalls, totalMethods, avgDuration, totalTime,
  totalExceptions, errorRate}`
- `findSlowMethods()` / `findBottlenecks()` items: `{name, class, method,
  callCount, avgDuration, p95, p99, totalTime, errors, impactScore}` (drop
  `min`/`max`/`p50` — confirmed unread by any consumer)
- `findErrorHotspots()` items: `{name, class, method, callCount, exceptions,
  errorRate}` — rename `totalCalls`→`callCount`, `errors`→`exceptions` to
  match what `table-renderer.js:renderErrors` actually reads
- Update the three consumers only where the analyzer's new shape genuinely
  differs from what they already expected (should be zero/near-zero changes,
  since the analyzer is being conformed TO them, not the other way around —
  verify this by diffing what each consumer reads against the new contract).
- `metrics-panel.js:28-30` currently recomputes error rate itself from the
  wrong field name instead of using the analyzer's own precomputed
  `errorRate` — use the analyzer's value directly.
AC: trace a real Python program through `flowtrace run` into a fresh
`flowtrace.jsonl`, `flowtrace analyze` it, and `curl` every API response the
frontend/mcp-tools.js/cli.js consume (`GET /api/analyze/:id`) — no `NaN`,
`undefined`, or missing field anywhere in the response for a trace that
includes both successful and erroring calls (need a fixture/repro that
actually raises inside a traced function, so `errorHotspots` is non-empty
and testable). `flowtrace-dashboard/cli.js analyze|slow|bottlenecks|errors`
against the same file prints real numbers, not `NaN`/crashes on
`.toFixed(2)` of `undefined`.

### AC2 — Time Distribution renders as an actual duration-range histogram
Rewrite `calculateTimeDistribution()` to bucket every call (not per-method —
across the whole trace) into duration ranges and return `{ranges: [{range,
count, percentage}]}`, matching exactly what `chart-renderer.js` already
consumes. Buckets: `<1ms`, `1-10ms`, `10-100ms`, `100ms-1s`, `1-10s`, `>10s`
(only emit buckets that have at least one call — an all-fast trace shouldn't
show five empty bars).
AC: same repro trace as AC1 — `GET /api/analyze/:id`'s
`results.performance.timeDistribution.ranges` is a non-empty array of
`{range, count, percentage}` where `percentage` values sum to ~100 and
`count` values sum to `totalCalls`.

### AC3 — `flowtrace analyze` opens at most one tab per genuinely-new server
In `flowtrace-cli/lib/commands/analyze.js`, the already-running-reuse path
(the `if (await checkHealth(...))` branch, not the fresh-spawn branch) must
NOT call `openBrowser()`. It still calls `postAnalyzeFile`/`buildOpenUrl` (so
the trace is pre-loaded server-side per the earlier auto-load fix) but prints
the resulting URL to stdout instead of opening a browser tab — e.g. `Dashboard
already running — view this trace at: <url>`. Only the fresh-spawn path (a
brand-new server this invocation started) opens a browser tab automatically.
AC: `flowtrace analyze a.jsonl` (fresh spawn) opens exactly one browser call;
a second `flowtrace analyze b.jsonl` while the first server is still running
calls `postAnalyzeFile`/prints the URL but does NOT call `openBrowser` —
verify via the existing `_openBrowser` test-injection point, asserting call
count, not by literally counting OS browser tabs (can't be done headlessly).

## Out of scope
- Any other dashboard UI/UX change beyond making the existing panels render
  real data.
- `findErrorHotspots`'s error-hotspots view design, `buildCallTrees`'s tree
  view, or any other analyzer output not consumed by a real bug found here.
- The pre-existing `analysisCache` unbounded growth / `DELETE
  /api/analyze/:id` file-deletion risk / no-auth-on-LAN issue flagged as
  non-blocking in a prior flow's review — unrelated to this contract bug.

## Approach
One test per AC, using a real traced Python repro that includes both a
normal call and one that raises (needed to exercise `errorHotspots`/error
rate honestly, not with a zero-error trace that can't tell a broken
`NaN`-producing computation from a correctly-empty one). Update
`flowtrace-dashboard/test/test-analyzer.js`'s existing assertions to match
the new field names (it currently pins the old `_ns` contract this change
deletes).

## Verification
- `cd flowtrace-dashboard && npm test` (and the full `test/*.js` glob, since
  `package.json`'s own `test` script only wires one file — known, separate,
  non-blocking gap from a prior review)
- `cd flowtrace-cli && npm test`
- `make check-bundle`
- Manual: trace a real error-raising program, `flowtrace analyze` it, curl
  every field the frontend/cli.js/mcp-tools.js read
