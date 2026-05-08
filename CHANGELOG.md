# Changelog

All notable changes to FlowTrace.

## [2.0.0] - 2026-05-08

### Breaking changes

- Schema v2: campos renombrados/agregados. Ver `docs/migration-v1-v2.md`.
  - `timestamp` (ms) → `ts` (float seconds)
  - `event` "ENTER"/"EXIT" → "enter"/"exit"
  - `args`/`result` string JSON → object
  - `durationMicros`/`durationMillis` → `duration_ns`
  - Nuevos: `trace_id`, `span_id`, `parent_id` (W3C), `lang`, `module`, `visibility`, `depth`, `error`
- CLI commands trimmed: `init` / `run` / `analyze` (removed `install`/`update`/`status`).
- Capture rebuild zero-source-modification:
  - Java: OTel-Java agent + extension (ByteBuddy)
  - Python: importlib MetaPathFinder + AST in-body rewrite
  - Node/TS: Module._compile + ESM loader + babel transform
- Go/Rust/.NET deferred to `legacy/v1` branch (post-MVP).

### Added

- `flowtrace run -- <cmd>` auto-detect lang (pom.xml/pyproject.toml/package.json/tsconfig.json).
- MCP server v2 tools: `trace_tree`, `trace_find_error`, `trace_private_calls`, `trace_diff`.
- W3C trace context propagation across async boundaries.
- Schema validation: golden fixtures validate per JSON Schema 2020-12 in CI.
- CI matrix: java(jdk17) × python(3.9/3.11/3.13) × node(20/22) + bench informational.
- Bench harness `make bench` (per-lang baseline vs instrumented).
- Truncation parity across langs (`max-arg-length`).
- Demo `demo/fastapi-bugged/`: 3 bugs intencionales L1/L2/L3 — localizables via MCP.

### Fixed

- Python emitter: `error` ahora top-level en exit events (no anidado en `result.error`). `mcp-server trace_find_error` ahora localiza errores correctamente.
- Java: `ts` en epoch seconds (no ms — bug schema-passing pero off 1000x).
- Schema: bounds `ts ∈ [1e9, 1e10]` — atrapa ms-vs-s en validation.
- Node: babel visitor recursión infinita (sentinel `_flowtraceWrapped` + `path.skip()`).
- Node ESM loader: source string|Buffer|undefined variants.
- CLI Python: PYTHONPATH incluye `flowtrace_runtime` parent (sin esto user no recibia traces).
- Python generator `GeneratorExit` ya no se rutea como error.

### Internal

- 8 sprints completados (S0 foundation → S7 release).
- ~166 tests pasan: schema(32) + java(5) + python(30) + node(21) + mcp(6) + dashboard(1) + cli(72).
- 9/9 jobs verde en v2-ci.

## [1.x] - legacy

Ver branch `legacy/v1`. Soporte Java/Node/Python/Go/Rust/.NET con schema v1 (renombrado v1 fields). v1 logs detectados por `mcp-server v1-compat` shim — emite warning + retorna empty para v2-only tools.
