# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlowTrace Debugger — a runtime instrumentation toolkit. Each supported runtime
ships a capture layer that emits a unified JSONL trace (`flowtrace.jsonl`,
schema v2) consumable by a CLI, a dashboard, and an MCP server. The traces are
designed to be read by AI tools: the point is to give an agent evidence of what
the program actually did, rather than have it infer behaviour from source.

Supported runtimes: **Java** (OpenTelemetry javaagent extension), **Node /
TypeScript** (CJS hook + ESM loader + SWC transform), **Python** (import hook +
AST transform). These three are the whole product — Go, Rust and .NET were v1
experiments and have been removed.

`capture/browser/` is a fourth, deliberately narrower layer: with no
`AsyncLocalStorage` in a browser there is no ambient async context, so it does
not instrument every function. It records HTTP, navigation and errors, and
ships them to the dashboard collector (`POST /api/trace`) rather than to a
file.

## Repository layout (pnpm workspace for the JS parts)

| Path | Role | Build system |
|------|------|--------------|
| `capture/java/flowtrace-otel-extension/` | OTel javaagent extension: ByteBuddy advice + JSONL emitter | Maven (bytecode target 11) |
| `capture/node/` | CJS `Module._load` hook, ESM loader, SWC transform, runtime | pnpm |
| `capture/python/` | `sitecustomize` bootstrap, import hook, AST transformer, runtime | setuptools |
| `capture/browser/` | Browser capture (HTTP / router / errors) + Angular bindings | pnpm |
| `schema/flowtrace-v2.json` | **The contract.** JSON Schema for every emitted event | — |
| `examples/golden/` | Golden fixtures: real capture output, committed and diffed in CI | — |
| `scripts/` | Golden runners/normalizer, schema validation, plugin checks | pnpm |
| `flowtrace-cli/` | Cross-language installer (`flowtrace` binary) | pnpm |
| `flowtrace-dashboard/` | Express server + static perf UI | pnpm |
| `mcp-server/` | MCP server exposing `log_*` and `trace_*` tools | pnpm + tsc |
| `plugin/` | The distributable Claude Code plugin (see below) | — |
| `docs/` | English (`docs/en`) + Spanish (`docs/es`) docs |

## Build / test commands

Everything is driven from the root `Makefile` — there is no per-subproject
install script. `make test` is the source of truth.

```bash
make build            # build-java + build-python + build-node + build-mcp
make test             # schema + golden + java + python + node + browser + mcp + dashboard + cli + plugin bundle

make test-java        # JUnit 5 (capture/java)
make test-python      # pytest (capture/python)
make test-node        # node:test (capture/node)
make test-browser     # capture/browser + collector e2e
make test-mcp         # MCP server tests
make validate-schema  # every expected.jsonl against schema/flowtrace-v2.json
make check-golden     # re-run every capture and diff against its committed fixture
make gen-golden       # regenerate the fixtures (review the diff!)
make bundle-mcp       # rebuild plugin/mcp/server.bundle.js after touching mcp-server/src
make check-bundle     # verify that bundle is current and boots standalone
```

Single tests:

```bash
cd capture/java/flowtrace-otel-extension && mvn test -Dtest=FlowtraceEmitterTest#method
cd capture/python && python -m pytest tests/test_x.py::test_y
cd capture/node && node --test test/test-traceparent.mjs
```

## Architecture

### Trace event contract (load-bearing across all capture layers)

`schema/flowtrace-v2.json` is authoritative — read it before changing anything
that emits. Two event variants, `enter` and `exit`, with
`additionalProperties: false`:

```json
{"ts":<epoch seconds, float>,"trace_id":"<32 hex>","span_id":"<16 hex>","parent_id":"<16 hex>|null",
 "event":"enter|exit","thread":"<name>","lang":"java|node|python|ts","module":"<m>","class":"<C>",
 "method":"<m>","visibility":"public|private|internal|unknown","args":{...},"depth":<n>}
```

`exit` additionally carries `result` (**required**, `{}` when there is no
value), `duration_ns`, and an optional `error` of `{type, msg, stack}`.

Two rules that have each already been broken once:

- **A failed call is an `exit` with `error` set.** There is no `event: "error"`
  variant; the schema rejects it. `result` is still required on that branch —
  emit `{}`.
- **Do not rename fields** without changing every capture layer, the schema,
  the golden fixtures and every consumer (`mcp-server`, `flowtrace-dashboard`)
  in the same commit.

The ids are W3C Trace Context compatible, so a trace survives a process hop:
`traceparent` is parsed on the way in and rendered on the way out.

### Golden fixtures are the regression net

`examples/golden/<id>/expected.jsonl` is **real capture output**, normalized
and committed. `make check-golden` re-runs each fixture and diffs. The registry
is `scripts/golden/runners.mjs` — add a fixture there and CI picks it up
automatically.

`scripts/golden/normalize.mjs` replaces what is genuinely non-deterministic:
trace/span ids (renumbered in first-appearance order, so tree *shape* is still
asserted), `ts`, `duration_ns`, Java identity hashes, and error stack frames.
Anything else is compared verbatim.

A consequence worth remembering: because every `trace_id` is rewritten to one
constant, **a golden fixture cannot assert cross-process correlation**. That
property lives in `capture/node/test/test-cross-process.mjs`, which spawns two
real processes.

### Filtering: package prefix is mandatory in practice

Without a prefix each capture layer instruments frameworks and stdlib and the
trace explodes. Every layer honours a package/module prefix
(`-Dflowtrace.package-prefix`, `FLOWTRACE_PACKAGE_PREFIX`), and the CLI
auto-detects one on `flowtrace init`. When investigating "the log is huge" or a
perf complaint, check prefix wiring first.

### Truncation

`TRUNCATION_SYSTEM.md` documents the shared rules for truncating `args` /
`result`. Each layer takes a `max-arg-length` knob (`0` = no truncation), and
`examples/golden/truncation/{java,node,python}` pin parity across runtimes.

### Per-runtime capture strategy (don't conflate them)

- **Java** — an *OpenTelemetry javaagent extension*, not a standalone premain
  agent. `FlowtraceInstrumentationModule` / `FlowtraceTypeInstrumentation`
  select methods; `FlowtraceAdvice` weaves enter/exit and derives ids from
  `Span.fromContext(Context.current())`, which is why incoming `traceparent`
  works with no code of ours. The OTel agent version therefore decides which
  JDKs can be instrumented — its bundled ByteBuddy must know the class file
  version. Bytecode target stays at 11 deliberately: it is the floor of what
  can be instrumented, not the JDK we build on. CI runs 17, 21 and 25.
- **Node** — `src/cjs/hook.js` patches `Module._load`; `src/esm/loader.mjs` is
  the ESM loader; `src/transform/swc.js` rewrites matched functions to call the
  `__ft_enter` / `__ft_exit` / `__ft_exit_error` helpers. Context propagation is
  `AsyncLocalStorage`.
- **Browser** — no module rewriting and no ambient context. `api.js` holds all
  the logic as plain functions; `angular.js` is wiring only, so the part that
  needs a framework to test is the part least likely to be wrong. Browser work
  maps onto the existing schema fields (`module` = http|router|error) rather
  than extending the schema.
- **Python** — `stub/sitecustomize.py` bootstraps, `finder.py` / `loader.py`
  install an import hook, `transformer.py` rewrites the AST to call the same
  helper trio. Context propagation is `contextvars`. Note the deliberate
  divergence from Node: `current_depth` holds the depth of the span *about to
  start*, so `remote_context` seeds 0 where Node seeds -1.

### CLI orchestrator (`flowtrace-cli`)

`bin/flowtrace.js` is the entry point; commands live in `lib/commands/`.
`lib/detect.js` detects project type (`java` / `python` / `node` / `ts`) and the
package prefix, then writes `.flowtrace/config.json` into the target project and
updates its `.gitignore`. When adding a runtime, add a detector + command here —
do not modify the capture layers.

### MCP server (`mcp-server/`)

TypeScript, `@modelcontextprotocol/sdk`, entry `src/server.ts`. Sessions are an
in-memory `Map`; a log is loaded once per `log_open` and queried through
`log_search` / `log_aggregate` / `log_schema`. `src/trace-tools.ts` implements
`trace_tree` / `trace_find_error` / `trace_private_calls` / `trace_diff`.
Transport is stdio — **never write to stdout** outside the MCP protocol.

### Plugin (`plugin/`)

The distributable Claude Code plugin: skill, subagent, commands, and the MCP
server as a committed single-file esbuild bundle at `plugin/mcp/server.bundle.js`.
A plugin install copies a directory and runs no build, so anything the plugin
references must be inside `CLAUDE_PLUGIN_ROOT`, tracked by git, and runnable
with no `node_modules`. `scripts/check-plugin.mjs` enforces exactly that and
boots the bundle in an empty directory. Run `make bundle-mcp` after touching
`mcp-server/src`.

`.claude-plugin/marketplace.json` at the root makes this repo installable as the
**Rixmerz** marketplace.

## Project conventions

- User-facing CLI text is Spanish (matches README.md); English mirror in README.en.md.
- Code, comments and commit messages are English.
- `flowtrace.jsonl` is the default log name everywhere; tools accept overrides.
- Generated project files go under `.flowtrace/` in the user's repo.
- Schema version is `2.0.0` and all capture layers lock to it together.

## Pre-existing context to honor

- `.claude/rules/` (loaded automatically): `autonomous-strategy.md`,
  `commit-discipline.md`, `security-awareness.md`, plus per-language rules.
- `.claude/skills/` holds the language pattern skills plus `debug`, `testing`,
  `validation`. `.claude/commands/` has `status` (repo health check).
- `CONTRIBUTING.md`, `ROADMAP.md`, `TRUNCATION_SYSTEM.md`, `docs/` — deeper
  context before large changes.

**No v1.** The v1 agents (a standalone Java premain agent, a separate JS agent,
and Go / Rust / .NET implementations) emitted a different schema —
`{"timestamp":<ms>,"event":"ENTER",...,"durationMicros":<n>}` — with no
`trace_id` or `span_id`, so nothing in the v2 pipeline can read their output.
They have been deleted along with the install scripts that drove them. Do not
resurrect them or reintroduce v1 field names.

**No jig.** This repo was previously scaffolded by jig (an orchestrator project,
now obsolete) which installed a hook pipeline, 14 subagents, workflow graphs and
an MCP entry. All of it has been removed. Every hook was invoked through a
hardcoded interpreter path (`/home/rixmerz/.local/share/uv/tools/jig-mcp/bin/python3`)
that exists on no other machine, so the pipeline failed on every tool call for
every other contributor. Do not reintroduce jig, DCC (`cube_*`), graph workflows
(`graph_*`) or `execute_mcp_tool` proxying.
