# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlowTrace Debugger — a multi-language call tracer that instruments code **without editing source**. Each supported runtime rewrites code at load time and emits a unified, OTel-compatible JSONL trace (`flowtrace.jsonl`) consumed by an MCP server, a performance dashboard, and a CLI. The traces are designed to be read by AI agents doing debugging.

**This repo is at v2.0.0. v2 supports exactly four runtimes: Java, Python, Node, TypeScript.** The v1 agents for Go, Rust, and .NET were **not ported** — they live frozen under `legacy/` and are not part of the build, the CLI, the schema, or CI. Do not treat them as supported; do not "fix" them without an explicit decision to revive them.

## Repository layout

There is no monorepo tool. Each subproject has its own build — always `cd` into it before running its commands, or use the root `Makefile`.

### v2 — active code

| Path | Role | Build |
|------|------|-------|
| `capture/java/flowtrace-otel-extension/` | `io.flowtrace:flowtrace-otel-extension:2.0.0` — OpenTelemetry javaagent **extension** | Maven, Java 11 |
| `capture/python/` | `flowtrace-runtime` 2.0.0 — import hook + AST transform (zero runtime deps) | setuptools, Py ≥3.9 |
| `capture/node/` | `@flowtrace/capture-node` 2.0.0 — ESM/CJS load-time AST transform | npm/pnpm, Node ≥20.6 |
| `schema/flowtrace-v2.json` | **The contract.** JSON Schema 2020-12 for one trace event | — |
| `mcp-server/` | MCP server — 8 trace-analysis tools over stdio | npm + `tsc` |
| `flowtrace-dashboard/` | Express server (port 8765) + static perf UI + analyzer | npm |
| `flowtrace-cli/` | `flowtrace` binary — `init`, `run`, `analyze` | npm (commander + inquirer) |
| `examples/golden/` | Per-language fixture programs (`java`, `node`, `python`, `ts`) + truncation fixtures | — |
| `benchmarks/` | `run-bench.sh` overhead harness + `truncation-parity.sh` | bash |
| `scripts/validate-golden.mjs` | Ajv driver for `make validate-schema` | npm |
| `docs/` | `architecture.md`, `migration-v1-v2.md`, `HANDOFF_V2.md`, `release-notes-v2.0.0.md`, sprint designs | — |

### Frozen / stale — do not extend

| Path | Status |
|------|--------|
| `legacy/` | v1 agents: `flowtrace-agent` (Java premain), `flowtrace-agent-js`, `go/`, `rust/`, `dotnet/`. Not built, not tested, not in CI. |
| `agents/python/` | v1 Python agent (`@trace` decorator + `sys.setprofile`) + Django/Flask/FastAPI demos. Superseded by `capture/python/`. |
| `flowtrace-cli/agents/node/flowtrace-agent-js/` | **Third vendored copy** of the v1 JS agent, byte-identical to `legacy/flowtrace-agent-js/`. |
| `flowtrace-example/` | v1 Java sample app |
| `docs/en/installation.md`, `docs/es/installation.md` | v1 docs — still say `flowtrace --version → 1.0.0` |
| `analyze-logs.sh`, `run-node-flowtrace.sh`, `install*.sh`, `test-exclusions.sh` | v1 scripts. `analyze-logs.sh` greps `durationMicros` (a v1 field that no longer exists). |
| `ACTIVATION_GUIDE.md`, `BROWSER_AGENT_README.md`, `FLOWTRACE_TOOLS_ADDED.md`, `IMPLEMENTATION_COMPLETE.md`, `QUICK_START.md`, `PROJECT_SUMMARY.md`, `TRUNCATION_SYSTEM.md` | Written against v1. Verify against code before trusting any of it. |

`README.md` / `README.en.md` **are** current (v2, 4 runtimes).

## Build / test commands

Prefer the root `Makefile` — it is the v2 source of truth:

```bash
make help              # list targets
make build             # build-java + build-python + build-node
make test              # validate-schema + all capture tests + mcp-server + dashboard + cli tests
make validate-schema   # Ajv: examples/golden/*/expected.jsonl vs schema/flowtrace-v2.json
make bench             # benchmarks/run-bench.sh
make clean
```

Per-subproject:

```bash
# Java capture (OTel extension)
cd capture/java/flowtrace-otel-extension && mvn package
mvn test -Dtest=FlowtraceEmitterTest#methodName        # single
mvn test -DskipOtelAgentDownload                       # offline (skips agent jar fetch)

# Python capture
cd capture/python && pip install -e .[dev]
python -m pytest tests/ -v
python -m pytest tests/test_transformer.py::test_name  # single

# Node capture
cd capture/node && pnpm install && node --test test/*.mjs
node --test test/test-transform.mjs                    # single

# MCP server
cd mcp-server && npm run build && node test/test-trace-tools.mjs

# Dashboard
cd flowtrace-dashboard && npm start && node test/test-analyzer.js

# CLI
cd flowtrace-cli && node test/test-cli.js   # also test-cli-{java,python,node}.js, test-detect.js, test-cli-autodetect.js, test-analyze.js
```

**CI is currently dead.** `.github/workflows/v2-ci.yml` triggers only on `push`/`pull_request` to branch `v2/main`, but the default branch is now `main`. Nothing runs on push. Fix the trigger before relying on green checks.

## Architecture

### The trace event contract (load-bearing — read `schema/flowtrace-v2.json` first)

One JSON object per line. Two event types, lowercase. **W3C trace context is mandatory on every event**, which is what makes call-tree reconstruction possible:

```json
{"ts":1746664666.123,"trace_id":"<32 hex>","span_id":"<16 hex>","parent_id":"<16 hex>|null",
 "event":"enter","thread":"main","lang":"java|python|node|ts","module":"...","class":"...",
 "method":"...","visibility":"public|private|internal|unknown","args":{},"depth":0}
```

`exit` events add `result` (object) and `duration_ns` (integer), and optionally `error: {type, msg, stack[]}`. `additionalProperties: false` on both variants — an extra field is a **schema violation**, not a harmless addition.

Non-obvious constraints:
- `ts` is **Unix epoch seconds as a float** (range-checked 1e9–1e10), not milliseconds.
- Durations are `duration_ns` (nanoseconds, integer). There is no `durationMicros`/`durationMillis`.
- `args` and `result` are **objects**, not JSON-encoded strings.
- `visibility` is a first-class field — instrumenting private methods is a deliberate v2 feature and `trace.private_calls` depends on it.

Changing this schema means changing 3 emitters + 4 consumers + the golden fixtures at once. Don't do it piecemeal.

### v1 → v2 schema break (the single biggest source of confusion here)

| v1 | v2 |
|----|----|
| `timestamp` (ms int) | `ts` (epoch seconds float) |
| `event: "ENTER"/"EXIT"` | `event: "enter"/"exit"` |
| `durationMicros`, `durationMillis` | `duration_ns` |
| `args`/`result` as JSON strings | `args`/`result` as objects |
| no trace context | `trace_id` / `span_id` / `parent_id` required |

The two formats are mutually unreadable and **no converter exists** (`mcp-server/src/v1-compat.ts` only *detects* v1 — the name is misleading). Consumers detect v2 via an `isLikelyV2` check and **silently drop** non-matching lines, so feeding a v1 log to a v2 tool yields an empty result, not an error. When a trace analyzes as zero events, check the schema version before debugging anything else.

### Per-language instrumentation (three genuinely different mechanisms — don't conflate)

- **Java** — an **OTel javaagent extension**, not a standalone premain. No `Premain-Class`; discovery is via `META-INF/services` SPI (`InstrumentationModule` → `FlowtraceInstrumentationModule`). ByteBuddy is `provided` — the extension only supplies `ElementMatcher`s and an advice class; the OTel agent does the retransformation. `FlowtraceAdvice` writes JSONL **directly, bypassing OTel span batching and any SpanExporter** — `FlowtraceExtension.customize()` is an intentional no-op that exists only so the SPI is found. Jackson is shaded to `io.flowtrace.shaded.jackson`. `getAdditionalHelperClassNames()` must list the emitter/advice classes or they are invisible to the instrumented app's classloader. Constructors and `<clinit>` are excluded.
- **Python** — a `MetaPathFinder` at `sys.meta_path[0]` (`finder.py`) delegating location to `PathFinder`, then a `SourceFileLoader` subclass (`loader.py`) whose `source_to_code()` runs `FlowtraceTransformer` (`ast.NodeTransformer`). `sys.setprofile` is gone. Rewrites function bodies **in place** rather than wrapping. Helpers use a **single** underscore (`_ft_enter`) specifically to dodge `__name` mangling inside class bodies. Compiled results cache to `~/.flowtrace/cache/py/<sha256>.pyc`. A MetaPathFinder never sees `__main__`, so `stub/sitecustomize.py` re-runs `python script.py` through `runpy`; for `python -m foo` and `pytest` the main module is **not** transformed and it warns on stderr.
- **Node/TS** — `module.register()` + an ESM `load` hook (`src/esm/loader.mjs`) and a patch of `Module.prototype._compile` (`src/cjs/hook.js` — `_compile`, not the v1 `Module._load`). Both feed `src/transform/swc.js`, which **despite its filename is a Babel transform** (`@babel/parser` + `traverse` + `generator`); `@swc/core` is used *only* to strip TypeScript syntax. Injects `__ft_enter`/`__ft_exit`/`__ft_exit_error`/`__ft_run`. `bootstrap.mjs` self-propagates to workers and child processes by appending to `NODE_OPTIONS` (guarded by `FLOWTRACE_INITED`).

### Activation (each layer, exactly)

```bash
# Node / TS
node --import file:///abs/capture/node/src/bootstrap.mjs app.js

# Python
PYTHONPATH=/abs/capture/python/stub FLOWTRACE_ENABLE=1 \
FLOWTRACE_PACKAGE_PREFIX=mypkg python script.py

# Java
java -javaagent:opentelemetry-javaagent.jar \
     -Dotel.javaagent.extensions=/abs/flowtrace-otel-extension-2.0.0.jar \
     -Dflowtrace.package-prefix=com.example \
     -Dflowtrace.output=/abs/flowtrace.jsonl \
     -Dotel.traces.exporter=none -Dotel.metrics.exporter=none \
     -Dotel.logs.exporter=none -Dotel.javaagent.logging=none -jar app.jar
```

Or let the CLI assemble it: `flowtrace run -- <cmd>`.

### Scoping: the package prefix, and its three inconsistent semantics

Without a prefix, instrumentation covers frameworks and stdlib and logs explode. Every layer has a prefix knob — but they **do not behave the same**, which is a real footgun:

| Layer | Knob | Match semantics | Default when unset |
|-------|------|-----------------|--------------------|
| Node | `FLOWTRACE_PACKAGE_PREFIX` | path substring | **on** — everything under `cwd` (`/node_modules/` always excluded) |
| Python | `FLOWTRACE_PACKAGE_PREFIX` | comma-separated **dotted module** prefixes | **off** — nothing instrumented |
| Java | `-Dflowtrace.package-prefix` | class-name prefix | **off** — logs a warning, matches nothing |

When triaging "log too large" or perf complaints, check prefix wiring first. When triaging "no output at all" on Python or Java, check that the prefix is set at all. The CLI auto-detects it in `flowtrace init`.

### Truncation

`max-arg-length` caps `args`/`result` payloads (`0` = unlimited): `FLOWTRACE_MAX_ARG_LENGTH` (Node/Python), `-Dflowtrace.max-arg-length` (Java); the CLI writes `maxArgLength: 512` into `.flowtrace/config.json`. Cross-language parity is checked by `benchmarks/truncation-parity.sh` against `examples/golden/truncation/`. `TRUNCATION_SYSTEM.md` predates v2 — verify it against code.

### MCP server (`mcp-server/`) — the primary AI-facing surface

TypeScript, `@modelcontextprotocol/sdk`, stdio transport. Entry `src/server.ts`; tools in `src/trace-tools.ts`; JSONL loading in `src/lib/jsonl.ts`. **Never write to stdout outside the MCP protocol** — use stderr.

Eight tools:

| Tool | Purpose |
|------|---------|
| `log.open` | Load a `.jsonl` → `{sessionId, count, schemaVersion, malformed}` |
| `log.schema` | Field inventory + sample row |
| `log.search` | Substring filter over the stringified row, optional field projection, `limit` (default 200) |
| `log.aggregate` | `groupBy` + `count/sum/avg/max/min` |
| `trace.tree` | Reconstruct the call tree for one `trace_id` via `parent_id` |
| `trace.find_error` | First error + the root→error path |
| `trace.private_calls` | Private-method call counts (uses the `visibility` field) |
| `trace.diff` | Two sessions: methods only-in-A/only-in-B + duration deltas beyond ±20% |

Known limits to work within (or fix deliberately): sessions are an in-memory `Map` with **no eviction and no `log.close`**; the whole file is read into `rows[]` with no size cap, so a multi-GB log OOMs the server; `log.search` re-`JSON.stringify`s every row per query; there is **no `list_traces`** tool, so discovering a `trace_id` requires `log.aggregate({groupBy:["trace_id"]})` first; and there is no slow-path/top-N tool (that logic lives only in the dashboard analyzer). Root-level `mcp-server/test-flowtrace-tools.js` and `test-expansion.js` are stale v1 scripts — the real test is `test/test-trace-tools.mjs`.

### Dashboard (`flowtrace-dashboard/`)

Express on port 8765 (`server/server.js` + `server/api/analyze.js`): `POST /api/analyze` (multipart), `GET /api/analyze/:id`, `GET /api/analyze`, `DELETE /api/analyze/:id`, `POST /api/analyze-file`, `GET /health`. `analyzer/metrics/performance.js` is v2-native: `findSlowMethods` (p50/p95/p99), `findBottlenecks` (`calls × avg`), `calculateTimeDistribution`, `findErrorHotspots`, `buildCallTrees`. No N+1 detection.

**Known break:** the analyzer emits v2 field names (`avg_ns`, `total_ns`) but the UI and wrappers still read v1 names — `public/js/components/metrics-panel.js`, `public/js/components/table-renderer.js`, `cli.js` (`.avgDuration.toFixed()` → TypeError), `mcp-tools.js` (`summary.avgDuration`, `summary.totalExceptions`). Also `flowtrace analyze` passes `FLOWTRACE_FILE` but `server/server.js` never reads it, so the dashboard opens empty. `mcp-tools.js` is **not** an MCP server despite the name — just functions that HTTP-call localhost:8765.

### CLI (`flowtrace-cli/`)

`bin/flowtrace.js`, commands in `lib/commands/`. `SUPPORTED_LANGS = {java, python, node, ts}` (`lib/commands/run.js`) — the `go`/`rust`/`dotnet` entries in `package.json` `keywords` are stale.

- `init` — detect language (`lib/detect.js`: pom/gradle → java; pyproject/setup.py/requirements → python; package.json + tsconfig → ts/node), write `.flowtrace/config.json` (`schemaVersion: "v2"`, packagePrefix, `maxArgLength: 512`), append `.flowtrace/` to `.gitignore`.
- `run -- <cmd>` — assemble the per-language activation above; prompts via inquirer on multi-language repos.
- `analyze [file] [--last]` — pick the newest `.flowtrace/*.jsonl` and open the dashboard. Note it resolves the repo root as 3 dirs up, so it only works from a git checkout, not a global install.

When adding a language, add a detector + a `capture/<lang>/` layer + golden fixtures + a `lang` enum value in the schema. Don't modify existing capture layers to accommodate it.

## Conventions

- User-facing CLI text is **Spanish** (matches `README.md`); `README.en.md` is the English mirror.
- Commit messages in **English**, conventional commits with a `Why:` body explaining root cause or rationale. One logical change per commit.
- Default log filename is `flowtrace.jsonl` everywhere; generated files go under `.flowtrace/` in the user's repo and are auto-gitignored.
- All three capture layers are version-locked at `2.0.0` against `schema/flowtrace-v2.json`. Bumping one emitter without the others breaks consumers.
- `.mcp-docs/` (livespec index) is local tooling state — keep it out of git.

## Traps worth knowing before you change anything

1. **`examples/golden/*/expected.jsonl` do not exist.** The READMEs describe them as "the spec", but no fixture is committed — so `make validate-schema` has nothing real to compare and the goldens are prose-only.
2. **No real benchmark numbers.** `benchmarks/run-bench.sh` silently falls back to `instrumented = baseline` when it can't find the agent/loader. All six committed `results-*.json` are that no-op (`overhead_pct: 0`). The stated gates (Java <15%, Python <20%, Node <15%) are unverified.
3. **Three copies of the v1 JS agent** (`legacy/`, `flowtrace-cli/agents/node/`, plus the v1 tree) inflate every code-quality and dead-code metric. ~215 of ~301 static dead-code candidates are in `legacy/`.
4. Static dead-code analysis is unreliable on this repo by construction — ByteBuddy weaving, import hooks, AST-injected helpers, and Babel visitor objects are all invisible to a call graph. Don't delete on that evidence alone.
