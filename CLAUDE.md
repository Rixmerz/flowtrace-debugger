# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlowTrace Debugger — a multi-language runtime instrumentation toolkit. Each language ships its own agent that emits a unified JSONL trace format (`flowtrace.jsonl`) consumable by a CLI installer, a performance dashboard, and an MCP server. Logs are designed to be analyzed by AI tools.

Supported runtimes: Java (JVM agent, ByteBuddy), JavaScript/TypeScript (Node `Module._load` hook + decorators), Python (sys.setprofile / decorators), Go (AST source-rewrite), Rust (`#[derive]` macro), .NET/C# (Source Generator + `[Trace]` attribute).

## Repository layout (workspaces, no monorepo tool)

Subprojects each have their own build; there is no root package manager. Always `cd` into the subproject before running its commands.

| Path | Role | Build system |
|------|------|--------------|
| `flowtrace-agent/` | Java premain agent (ByteBuddy bytecode rewrite) | Maven (`pom.xml`, Java 11) |
| `flowtrace-agent-js/` | Node CommonJS + ESM loader, TS decorators | npm (`build.js`, custom) |
| `agents/python/` | Python agent + `flowctl-py` CLI | setuptools (`pyproject.toml`, Py ≥3.8) |
| `agents/go/` | Go AST instrumenter + `flowctl` CLI | Go modules (1.24) |
| `agents/rust/` | `flowtrace-agent` crate + `flowtrace-derive` proc-macro + `flowctl-rs` | Cargo workspace |
| `agents/dotnet/` | `Flowtrace.Agent` + Source Generator + `flowctl-dotnet` | `dotnet` SDK |
| `flowtrace-cli/` | Cross-language installer (`flowtrace` binary) | npm (Node, commander+inquirer) |
| `flowtrace-dashboard/` | Express server + static HTML/JS perf UI | npm |
| `mcp-server/` | MCP server exposing log analysis tools | npm + TypeScript (`tsc`) |
| `flowtrace-example/` | Java sample app for end-to-end testing | Maven |
| `examples/` | Per-framework demos (React, Next.js, Angular, Vue, ESM, CJS) | per-example npm |
| `docs/` | English (`docs/en`) + Spanish (`docs/es`) docs |

## Build / test commands

Top-level orchestration:

```bash
./install-all.sh            # Build Java agent, JS agent, CLI; offer MCP IDE wiring
./install.sh                # Java agent only (mvn package)
./install-flowtrace-cli.sh  # CLI only
./test-exclusions.sh        # Exclusions regression
./analyze-logs.sh <file>    # Helper to summarize a flowtrace.jsonl
./run-node-flowtrace.sh     # Run a Node app with the agent preloaded
```

Per-subproject:

```bash
# Java agent
cd flowtrace-agent && mvn package           # produces target/flowtrace-agent-*.jar
mvn test -Dtest=FullyQualifiedClass#method  # single test

# JS agent
cd flowtrace-agent-js && npm run build && node test/run-tests.js

# Python agent
cd agents/python && pip install -e .[async,django,flask,fastapi]
python -m pytest tests/                      # full
python -m pytest tests/test_x.py::test_y     # single

# Go agent
cd agents/go && go build ./... && go test ./...
go test ./internal/... -run TestName         # single

# Rust agent
cd agents/rust && cargo build --workspace && cargo test --workspace
cargo test -p flowtrace-agent test_name      # single

# .NET agent
cd agents/dotnet && dotnet build && dotnet test
dotnet test --filter FullyQualifiedName~Name # single

# CLI
cd flowtrace-cli && node test/test-cli.js

# MCP server
cd mcp-server && npm run build && npm run dev    # dev = ts-node src/server.ts

# Dashboard
cd flowtrace-dashboard && npm start              # express server on default port
```

## Architecture

### Trace event contract (load-bearing across all agents)

Every agent emits one JSON object per line to `flowtrace.jsonl` with this shape:

```json
{"timestamp":<ms>,"event":"ENTER|EXIT","thread":"<name>","class":"<Class>","method":"<m>","args":"<json string>","result":"<json string>","durationMicros":<n>,"durationMillis":<n>}
```

ENTER and EXIT are paired; EXIT carries `result` + duration. Field names are stable — downstream tools (`mcp-server`, `flowtrace-dashboard`, `analyze-logs.sh`) parse this exact schema. **Do not rename fields** without coordinated changes across all agents and consumers.

### Filtering: package-prefix is mandatory in practice

Without a prefix, agents instrument frameworks and stdlib → logs explode. Each agent honors a "package prefix" (Java property, env var, or config file) to scope instrumentation to user code. The CLI auto-detects the prefix on `flowtrace init --yes`. When fixing perf or "log too large" bugs, check prefix wiring first.

### Truncation system

`TRUNCATION_SYSTEM.md` documents shared rules for truncating `args`/`result` payloads. Each agent has a `max-arg-length` knob (`0` = no truncation). Tests in `examples/run-truncation-tests.sh` validate parity across runtimes.

### Per-language instrumentation strategy (don't conflate)

- **Java**: premain `Instrumentation` API + ByteBuddy `AgentBuilder` rewrites class bytes at load time. Entry: `FlowTraceAgent.premain` → `FlowTraceAdvice` weaves ENTER/EXIT around matched methods.
- **Node**: monkey-patches `Module._load` (CJS) and provides an `--experimental-loader` (ESM) at `src/esm-loader.mjs`. Decorators in `src/decorators.js` for opt-in TS use; require `experimentalDecorators` + `emitDecoratorMetadata` in `tsconfig`.
- **Python**: hybrid — explicit `@trace` decorator and a `sys.setprofile` fallback for global tracing. CLI in `flowctl-py/main.py`.
- **Go**: no runtime hooks — `flowctl instrument` rewrites source AST under `internal/instrumenter/` to inject `defer flowtrace.Trace(...)()` calls. Run before `go build`.
- **Rust**: `#[derive(FlowTrace)]` proc-macro in `flowtrace-derive` crate; the runtime crate in `flowtrace-agent` provides loggers and optional middleware (actix, axum) gated by Cargo features.
- **.NET**: Source Generator (`Flowtrace.Agent.SourceGenerator`) emits trace wrappers at compile time for methods marked `[Trace]`; ASP.NET Core + EF Core integrations live in subfolders of `Flowtrace.Agent`.

### CLI orchestrator (`flowtrace-cli`)

`flowtrace-cli/bin/flowtrace.js` is the user-facing entry point. Commands (`init`, `install`, `run`, `update`, `status`) live in `lib/commands/`. The CLI **detects project type** (Java vs Node) and writes a `.flowtrace/config.json` plus a `run-and-flowtrace.sh` script into the target project, copies the appropriate agent artifact, and updates `.gitignore`. When extending support to another language, add a detector + command file there — do not modify the agents.

### MCP server (`mcp-server/`)

TypeScript MCP server using `@modelcontextprotocol/sdk`. Entry: `src/server.ts`. Sessions are in-memory `Map<sessionId, {rows, fields, path}>`; logs are loaded once per `log_open` and queried via `log_search` / `log_aggregate` / `log_schema`. Additional tools registered in `dashboard-tools.ts` and `flowtrace-tools.ts`. Output goes through stdio transport — never write to stdout outside the MCP protocol.

### Dashboard (`flowtrace-dashboard/`)

Express server in `server/server.js` exposing `/api/*` to the static `public/` UI. Analyzer logic in `analyzer/`. Has its own CLI entry `cli.js` and an MCP-tools shim `mcp-tools.js`.

## Project conventions

- Output language for user-facing CLI text: Spanish (matches README.md). English mirror in README.en.md.
- Log file name `flowtrace.jsonl` is the default everywhere; tools assume it but accept overrides.
- Generated project files are placed under `.flowtrace/` in the user's repo and auto-added to `.gitignore` by the CLI.
- All agents version-lock to `1.0.0` for the trace schema; bumping a single agent without bumping the others breaks consumers.

## Pre-existing context to honor

- `.claude/rules/` (loaded automatically) contains: `autonomous-strategy.md`, `commit-discipline.md`, `jig-methodology.md`, `quality-feedback.md`, `security-awareness.md`, plus per-language rules (`java.md`, `python.md`, `go.md`, `rust.md`, `typescript.md`, `jsbackend.md`).
- `.claude/agents/` contains 14 deployed agents (orchestrator, debugger, reviewer, tester, fixer, backend, frontend, architect, codebase-analyst, mcp, mcp-developer, git-snapshots, product-analyzer, workflow-executor) with all language pattern skills injected.
- `.mcp.json` points exclusively to jig — discover other MCPs via `proxy_tools_search`.
- `CONTRIBUTING.md`, `ROADMAP.md`, `IMPLEMENTATION_COMPLETE.md`, `FLOWTRACE_TOOLS_ADDED.md`, `BROWSER_AGENT_README.md`, `ACTIVATION_GUIDE.md`, `QUICK_START.md`, `TRUNCATION_SYSTEM.md` — read these for deeper context on subsystems before large changes.
