# Changelog

All notable changes to FlowTrace.

The **trace schema** is versioned separately from the tooling: it is `v2`, it
did not change in this release, and `schema/flowtrace-v2.json` remains the
contract every capture layer locks to. A trace produced by 2.0.0 is read
identically by 2.1.0.

## [Unreleased]

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

### Changed

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
