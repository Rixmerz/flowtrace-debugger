# Changelog

All notable changes to FlowTrace.

## [3.1.1]

### Fixed

- `flowtrace run` refuses to trace Node below 20.6 instead of emitting an empty
  trace — see the entry under 3.1.0 for why that failure mode deserves an
  up-front refusal. 3.1.0 shipped without it.

## [3.1.0]

### Added

- **Go capture layer** (`capture/go/`). Go returns as a real v2 capture layer,
  held to the same contract as the other three: schema-v2 JSONL, W3C trace
  context, and nothing for the user to edit. `flowtrace run --lang go -- go
  run ./cmd/api`; `go build` and `go test` work the same way.

  Go has no runtime hook to attach to — no import hook, no module loader, no
  bytecode agent — so instrumentation happens before the compiler runs.
  Packages are enumerated with `go list -json`, each matching file is
  rewritten, and the result reaches the compiler through `go build -overlay`.
  **The user's tree is never written to**, not one byte: the runtime is
  injected as `<their-module>/internal/flowtracert`, a package the compiler
  sees but the disk never holds, which is also why it needs no `require`, no
  `replace`, no `go.sum` entry and no network fetch. Both the transformer and
  the injected runtime are stdlib-only, so tracing can never conflict with the
  target's dependency graph.

  Rewriting is byte-splicing at AST offsets rather than printing a mutated
  AST, because printing shifts line numbers — a panic in instrumented code
  reports the original file at the original line, verbatim.

  A goroutine's spans nest under whatever spawned them, across a plain `go`
  statement, with no change to the traced code. This uses the pprof label slot
  (`g.labels`), which the Go runtime itself copies parent-to-child — the only
  mechanism that propagates without rewriting `go` statements, which would
  change when their arguments are evaluated.

  Field mapping is Go's own: a method's receiver type becomes `class` (empty
  for a package-level function), the package import path becomes `module`,
  exported/unexported becomes `public`/`private`, and `thread` is
  `goroutine-<id>`. A returned non-nil `error` populates the `error` field
  alongside `panic` — returning an error is ordinary control flow in Go, but
  it is also what a Go developer is debugging, and it is what makes
  `trace_find_error` useful there.

  **Requires Go 1.24 or newer.** The label slot only has the layout this
  depends on from 1.24; on 1.21–1.23 it is a `map[string]string`, and writing
  to it there crashes the profiler. Both the toolchain and the target module's
  own `go` directive are checked before any file is touched, and refused with
  an actionable message rather than a crash.

  Known limits, stated rather than discovered later: closures (`FuncLit`) get
  no span of their own, dependencies and the standard library are out of
  scope, goroutine pools defeat span inheritance because workers predate the
  span, and injecting a `defer` makes an instrumented function permanently
  non-inlinable.

- **Go joins a trace another process started.** Go was the one capture layer
  that could not take part in a distributed trace: Java, Node and Python all
  adopt an inbound W3C `traceparent`, while Go minted a fresh `trace_id` on
  every root span, so a Node → Go → Java chain produced three unrelated trees.
  You could show each hop was clean and still not show the chain was joined.

  Inbound is automatic from `FLOWTRACE_TRACEPARENT`, the same carrier and the
  same variable Java, Node and Python already read, so a parent seeds any
  child the same way regardless of language. For a server receiving the header
  on the wire, `flowtracert.SeedFromTraceparent(r.Header.Get("traceparent"))`
  at the top of the handler does the same thing and returns a restore func.

  Outbound is exposed as `flowtracert.CurrentTraceparent()` and left to the
  caller — deliberately, not as an oversight. Node attaches it automatically
  because `globalThis.fetch` and `http.request` are mutable bindings it can
  patch at runtime; Go resolves `net/http` at compile time, so the equivalent
  means rewriting standard-library call sites inside the `-overlay` pass, to
  inject a header the caller may already be setting. The propagation matrix in
  `docs/architecture.md` states per runtime which direction is automatic.

- **`FLOWTRACE_MAX_EVENTS`** — a per-process event cap for the Go layer
  (default 100,000; `0` disables). It only stops *new* spans from opening: a
  span whose `enter` was written always gets its `exit`, so an `enter` with no
  `exit` keeps meaning "this call never returned" and never "the cap dropped
  it". The file can therefore exceed the cap by up to the number of spans open
  when it is reached.

### Changed

- **Schema v2's `lang` enum accepts `"go"`.** Additive — every document valid
  before stays valid, so the schema is still v2.
- The plugin (2.3.0) learns Go: `/flowtrace:trace` detects a `go.mod` and takes
  the prefix from its `module` line, and the plugin and marketplace
  descriptions name Go alongside the other four.
- **The plugin ships `flowtrace` on your PATH.** Claude Code puts
  `<plugin-root>/bin` on PATH and `/flowtrace:trace` told agents to run
  `flowtrace run`, but the plugin shipped no `bin/` — `which flowtrace` came
  back empty, and tooling fell back to whatever checkout happened to be on
  disk. `plugin/bin/flowtrace` shells to a pinned
  `npx @rixmerz/flowtrace@<version>`; it cannot be the real CLI, because a
  plugin install copies a directory and runs no build while the CLI needs
  platform-specific native builds of `@swc/core`.
- **New MCP resource `flowtrace://runtimes`.** Which runtimes are supported,
  their minimum versions, how each is invoked, where the package prefix comes
  from, what cross-process propagation each has, and which npm package is
  real. It exists because that question had four contradictory answers in this
  repo at once, and an agent asked to trace a Go service picked whichever file
  it read first. `mcp-server/src/runtimes.ts` is now the source; the prose is a
  restatement.
- `scripts/check-plugin.mjs` additionally enforces that `plugin/bin/*` is
  tracked executable (mode 100755 — a shim committed 644 is not executable
  after a clone), that the shim's version pin matches
  `flowtrace-cli/package.json`, and that the booted bundle really serves
  `flowtrace://runtimes`.

### Fixed

- **`npm install -g @flowtrace/cli` was the first command in both READMEs, and
  that package has never existed on npm.** The published CLI is
  `@rixmerz/flowtrace`. Every user's first step 404'd — and with no resolvable
  `flowtrace` binary, tooling falls back to hand-wiring a capture layer or
  symlinking `@flowtrace/capture-node` out of a local checkout, which
  reproduces on exactly one machine and never in CI.
- **`@flowtrace/capture-node`, `@flowtrace/mcp-server` and
  `flowtrace-dashboard` are not installable and now say so.** All three are
  workspace-internal — vendored into the CLI tarball by
  `flowtrace-cli/scripts/vendor.mjs` or bundled into the plugin — but nothing
  marked them `private`, so they read as npm packages. `@rixmerz/flowtrace` is
  the only published package, and it carries every capture layer.
- **`README.en.md` did not mention Go at all** while `README.md` did, and
  `CLAUDE.md` stated Go had been removed. Reconciled.
- **The advertised Node floor was 18+; the capture layer has needed 20.6+ for
  some while.** The ESM loader registers with `module.register()`, which landed
  in 20.6 — `capture/node/package.json` has said `>=20.6` all along while both
  READMEs said 18+. Corrected to 20.6+, and `flowtrace run` now refuses on an
  older Node with the version and the reason instead of proceeding. This is the
  failure that most deserves an up-front refusal: the loader silently never
  registers and the trace comes out **empty**, which reads as "my code never
  ran" rather than as a version problem. The CLI's own `engines` floor stays at
  18 on purpose — tracing Java, Python and Go there is unaffected.
- **Both READMEs said traces land in `./flowtrace.jsonl`.** `flowtrace run`
  writes `.flowtrace/<timestamp>.jsonl` and prints the path on startup;
  `flowtrace.jsonl` is only the default when a capture layer is wired by hand.
- **Cross-process propagation was documented nowhere**, despite being real and
  covered end to end by `capture/node/test/test-cross-process.mjs` — so it kept
  being reported as a missing feature. `docs/architecture.md`, both READMEs,
  the skill and `/flowtrace:trace` now carry the per-runtime matrix.
- **`docs/architecture.md` described capture mechanisms the code stopped using.**
  It had Python on a `sys.setprofile` global hook and Node on a `Module._load`
  monkey-patch with `--experimental-loader`; both have been AST rewriting at
  load time for some while — Python through a `sys.meta_path` finder, Node
  through a loader registered with `module.register()`. Corrected alongside
  the new Go row, since a stale architecture doc is how the next reader
  inherits a wrong mental model.

## [3.0.3]

### Fixed

- **A Java virtual thread's span landed orphaned, in its own trace.**
  OpenTelemetry's `Context` propagation relies on a plain `ThreadLocal`,
  which neither platform nor virtual threads inherit across `Thread.start()`
  — found dogfooding the Java capture layer against a JDK 21 program using
  `Thread.ofVirtual()`. A virtual thread's call now correctly nests under
  its caller's span (same `trace_id`, correct `parent_id`) instead of
  starting a disconnected trace with `parent_id: null`. Fixed by snapshotting
  `Context.current()` at `Thread.start()` and restoring it for the duration
  of the virtual thread's `run()`. Scoped to virtual threads only — platform
  `Thread`s load before the javaagent's `premain` runs and are never
  retransformed by this mechanism, so their context is not propagated by
  this fix; a matcher that claimed otherwise, and did nothing, was removed
  along with the false doc claim.
- **That same fix, once added, leaked memory on a failed `Thread.start()`.**
  A virtual thread that never reaches `run()` — restarting an
  already-terminated one (`IllegalThreadStateException`), or a scheduler
  rejection (`RejectedExecutionException`) — left its snapshotted `Context`
  pinned in memory forever. `start()`'s advice now cleans up its pending
  entry on any exception out of `start()`, not just on the success path.

## [3.0.2]

### Fixed

- **The dashboard no longer labels every module-level function "Unknown".**
  `PerformanceAnalyzer._buildMethodStats` grouped calls by `class.method` and
  discarded `module` entirely, so `findSlowMethods`/`findBottlenecks`/
  `findErrorHotspots` never carried a module name for functions that aren't
  inside a class (the normal shape for Python/Node top-level functions).
  `table-renderer.js`'s `formatClassName` then rendered the resulting empty
  class as the literal string `"Unknown"`. The analyzer now keys by
  `module|class|method` (matching the convention `trace_diff`/
  `trace_private_calls` already use) and carries `module` on every row; the
  table renderer falls back to it when there is no class, and only reports
  `"Unknown"` when neither is present.

The **trace schema** is versioned separately from the tooling: it is `v2`, it
did not change in this release, and `schema/flowtrace-v2.json` remains the
contract every capture layer locks to. A trace produced by 2.0.0 is read
identically by 2.1.0.

## [3.0.1]

### Fixed

- **Instrumenting an async generator with a `return` no longer crashes at
  import.** The AST rewriter used to turn every `return` — bare or not —
  into a value-capturing form, but CPython only allows a bare `return`
  inside an `async def` containing `yield`; the rewritten form was always
  illegal there. A related pre-existing bug in `_has_yield()` (nested
  functions' yields leaking into the outer function's generator
  classification, via `ast.walk()` not honoring a `continue` the way the
  code assumed) is fixed alongside it — it fed the same misclassification
  into both the old wrapping-branch selection and this new guard.

## [3.0.0]

### Fixed

- **`_ft_exit` no longer crashes the traced process.** A function returning a
  `dict` with non-JSON-serializable values now has its `result` passed
  through `_to_json_safe` like every other return type, instead of being
  handed to the emitter raw.
- **A stale `__pycache__` no longer silently disables Python instrumentation.**
  `FlowtraceSourceLoader` now overrides `get_code()` so every import goes
  through `source_to_code()` (and FlowTrace's own content-hashed cache),
  instead of `SourceFileLoader` returning a pre-existing, un-instrumented
  `.pyc` from disk.
- **`flowtrace init`/`run` detect the Python import name, not just the PyPI
  distribution name.** `detectPythonPrefix()` now also checks
  `[tool.hatch.build.targets.wheel].packages`,
  `[tool.setuptools.packages.find]`, a single package under `src/`, and a
  single top-level package next to `pyproject.toml`, before falling back to
  the distribution-name guess. `flowtrace run` also warns on stderr with the
  final event count when a Python run completes with zero events.
- **`log_close` sessions are now distinguishable from unknown ones.** A
  session id closed via `log_close` reports a descriptive "was closed"
  message on reuse instead of the generic "Invalid sessionId".
- **`flowtrace init` detects the Python import name too, not just `run`.**
  `init` and `run` used to call two separately-implemented prefix-detection
  functions; `init`'s copy never received the distribution-name-vs-import-name
  fix above, so `flowtrace init` alone still printed the wrong prefix for
  exactly the case that motivated the original fix. Both commands now share
  one implementation (`lib/python-prefix.js`).
- **The dashboard no longer shows `NaN`/`NaN%` for every duration metric.**
  `PerformanceAnalyzer` had been rewritten to return raw-nanosecond,
  `_ns`-suffixed fields (`avg_ns`, `total_ns`, `p95_ns`, `p99_ns`,
  `totalErrors`) that none of its three real consumers
  (`metrics-panel.js`, `table-renderer.js`, `cli.js`) were ever updated to
  read. The analyzer now converts to milliseconds at its own boundary and
  emits the ms-based, consumer-matching contract those three already
  expected (`avgDuration`, `totalTime`, `totalExceptions`, `errorRate`,
  `p95`, `p99`, `callCount`, `exceptions`), with no dual emission of the old
  `_ns` names.
- **The Time Distribution chart no longer renders empty.**
  `calculateTimeDistribution()` returned a per-method breakdown
  (`{total_ns, distribution: [...]}`) while `chart-renderer.js` expected a
  duration-range histogram (`{ranges: [{range, count, percentage}]}`),
  so `.map()` on the missing `ranges` threw and the chart never drew. It now
  buckets every call across the whole trace into `<1ms`, `1-10ms`,
  `10-100ms`, `100ms-1s`, `1-10s`, `>10s` ranges, only emitting buckets that
  have at least one call.

### Changed

- **`flowtrace analyze` no longer opens a second browser tab when a
  dashboard is already running.** The reuse path still POSTs the trace and
  prints the resulting URL (`Dashboard already running — view this trace
  at: <url>`), but only a genuinely fresh server spawn now opens a browser
  tab automatically.
- **`flowtrace analyze` opens the trace already loaded**, instead of a bare
  dashboard tab the user then has to manually upload the JSONL into. It POSTs
  the file to the dashboard's `/api/analyze-file` (the same call
  `flowtrace-dashboard/mcp-tools.js` already made for MCP-agent callers) and
  opens `?analysis=<id>`; a failed pre-load falls back to the bare URL with a
  stderr warning rather than blocking the dashboard from opening at all.

- **BREAKING (behavior): argument redaction.** `_serialize_args` now redacts
  argument values whose name matches a redact-key list (case-insensitive
  substring match) before truncation, checked recursively so a matching key
  nested inside a dict argument is also caught, not just top-level ones. This
  applies by default even when `FLOWTRACE_REDACT_KEYS` is unset, using a
  built-in list: `password,secret,token,authorization,api_key,url,dsn,
  connection_string,email`. `FLOWTRACE_REDACT_KEYS`, when set, is
  comma-separated substrings ADDED to that built-in list, not a replacement
  for it. Any traced argument (or nested dict key) whose name contains one of
  those substrings is now emitted as `"<redacted>"` instead of its real
  value.
- **MCP `trace_tree` caps output.** Accepts optional `maxDepth` and
  `maxNodes` (default 2000 total nodes); an elided subtree carries
  `truncated: true` plus a count of elided descendants, and the top-level
  result reports `truncated`/`totalNodes`.
- **MCP `trace_diff` groups by `module + class + method`**, matching the key
  `trace_private_calls` already uses, instead of by method name alone —
  identically-named methods in different classes/modules no longer get
  averaged together. Rows also carry `module`/`class` fields, and are
  filterable/sortable by a `min_abs_delta_ns` floor so a tiny sub-microsecond
  percentage swing no longer outranks a large absolute regression.

## [2.1.0]

### Added

- **Browser capture** (`capture/browser/`). HTTP requests, route changes and
  unhandled errors, emitted as ordinary schema v2 events. It deliberately does
  not instrument every function: the browser has no `AsyncLocalStorage`, so
  there is no ambient async context to attribute an arbitrary call to the
  request that caused it. Angular bindings included; all the logic lives in
  `api.js` and is tested without Angular.
- **Trace collector** — `POST /api/trace` on the dashboard. Validates every
  event against the schema before writing, takes its destination from
  server-side config only, and restricts CORS to localhost.
- **Trace context across a process spawn.** `FLOWTRACE_TRACEPARENT` carries a
  W3C traceparent through the environment; Node injects it into every child it
  spawns, and Node, Python and Java each read it at startup. A test runner or
  CLI pipeline that shells out no longer splits into unrelated traces.
- **Automatic outgoing propagation** in Node. The bootstrap patches `fetch` and
  `http`/`https` so a request made by a dependency still joins the trace. A
  caller-set header always wins; nothing is attached outside a span.
- **Field-level filtering in `log.search` and `log.aggregate`** via `where`
  (method, class, module, visibility, ids, `has_error`, duration and depth
  ranges), plus `offset` paging.
- **`log.close`** and an LRU session cap (`FLOWTRACE_MCP_MAX_SESSIONS`,
  default 8).
- Java CI matrix over JDK 17, 21 and 25.

### Fixed

- **Java traces were invalid JSON under any comma-decimal locale.**
  `String.format("%.3f")` without a locale renders `"ts":1785481163,844` in
  Chile, Spain, Germany, France or Brazil, making every line unparseable. CI
  runs under an English locale, which is why nothing saw it.
- **`visibility: "protected"`** is not in the schema's enum, so every protected
  Java method produced an invalid event. It now maps to `internal`.
- **The error contract diverged across all three layers.** Java and Node omitted
  the required `result` on the throw path, producing schema-invalid events;
  Python put the error inside `result` where no consumer looked, so
  `trace.find_error` returned null on traces full of exceptions. All three now
  emit a top-level `error` with `result: {}`.
- **FlowTrace instrumented its own runtime** when run from source, killing the
  traced program silently — exit 0, no output, no events.
- **Outgoing propagation missed `import { request } from 'node:http'`.** A
  builtin's ESM facade snapshots its named exports when created, so a static
  import inside the runtime bound the unpatched function for applications using
  the named-import style.
- **FlowTrace could not instrument Java 25 at all.** The pinned OTel agent
  bundled a ByteBuddy that stops at class file version 24, so every class was
  skipped and the JVM exited cleanly having traced nothing.
- The MCP server handled an `event: "error"` variant the schema forbids; those
  branches were unreachable and their one test used a hand-crafted event no
  agent can emit.

### Changed

- **MCP tools renamed from dotted to underscored names** — `log.open` becomes
  `log_open`, `trace.tree` becomes `trace_tree`, and so on for all nine. Tool
  names are expected to match `^[a-zA-Z0-9_-]+$`, and strict clients reject a
  dot at registration, so the server exposed tools some clients simply could not
  see. Everything that referenced them — the skill, the subagent, the commands,
  the tests and the docs — moved in the same commit, and the plugin ships the
  server, so there is no separately versioned client to strand.
- **`log.search` returns `{total, offset, returned, truncated, rows}`** instead
  of a bare array. The previous shape silently sliced to 200 rows, so a caller
  could not tell 12 matches from 12,000. This is a breaking change for direct
  consumers of the tool; the MCP server ships inside the plugin as one unit, so
  there is no separately versioned client.
- The plugin now runs a committed, self-contained bundle
  (`plugin/mcp/server.bundle.js`). Previously `.mcp.json` pointed at a
  gitignored path outside `CLAUDE_PLUGIN_ROOT` that needed `node_modules`, so
  an installed plugin exposed no tools at all.
- Java compiles with `<release>` instead of `source`/`target`, which makes the
  Java 11 floor enforced rather than merely stated. The target stays at 11
  deliberately: for an agent it is the floor of what can be instrumented, not
  the JDK we build on.

### Removed

- **v1, entirely** — the standalone Java premain agent, the separate JS agent,
  the Go, Rust and .NET implementations, the v1 Python agent, the root install
  scripts and the v1 documentation. 288 files, roughly 52k lines. None of it
  emitted `trace_id` or `span_id`, so nothing in the v2 pipeline could read a
  single line of its output.

## [2.0.0]

Initial v2 release: unified JSONL schema with W3C trace context, capture layers
for Java, Node/TypeScript and Python, CLI, dashboard and MCP server.
