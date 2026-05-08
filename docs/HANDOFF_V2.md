# FlowTrace v2 — Sprint Handoff Plan

**Status**: Approved plan, pre-implementation. Branches not yet created.
**Owner**: Rixmerz
**Date**: 2026-05-07

---

## Functional Requirement (hard)

> **Zero source code modification.** No decorators, no annotations, no `tsconfig` flags, no manual `import`. User runs `flowtrace run -- <cmd>` — full call trace (including private/internal methods) emitted to JSONL.

---

## North Star

Evolve point-by-point manual debugging → log full call trace → AI agent debugs autonomously without human-inserted logs. MVP: Java, Python, Node, TypeScript.

---

## Architecture (3 layers)

```
L3 Consumer  : mcp-server (TS) + dashboard + flowtrace CLI
L2 Adapter   : event normalizer → JSONL schema v2
L1 Capture   : per-language, in-memory rewrite at load
                - Java   : OTel-Java agent + extension (ByteBuddy)
                - Python : importlib MetaPathFinder + AST rewrite
                - Node   : Module._compile hook + swc/babel transform
                - TS     : same Node path; swc TS preset
```

## Schema v2 (canonical)

```json
{
  "ts": 1699999999.123456,
  "trace_id": "<W3C>",
  "span_id": "<W3C>",
  "parent_id": "<W3C>",
  "event": "enter|exit|error",
  "thread": "main",
  "lang": "java|python|node",
  "module": "com.example.foo",
  "class": "UserService",
  "method": "createUser",
  "visibility": "public|private|internal|unknown",
  "args": {} ,
  "result": {} ,
  "error": {"type":"","msg":"","stack":[]},
  "duration_ns": 222000000,
  "depth": 3
}
```

JSON Schema source of truth: `schema/flowtrace-v2.json` (Sprint 0).

---

## Sprint Roadmap (8 sprints, ~1 wk each)

| # | Sprint | Goal | Gate |
|---|--------|------|------|
| 0 | Foundation | Branch split, schema v2, fixtures | Schema validates golden fixtures |
| 1 | Consumers refactor | mcp-server + dashboard + CLI on schema v2 | All MCP tools return v2 fields |
| 2 | Java capture | OTel-Java agent + extension custom emits v2 | Spring Boot + plain JVM golden traces match |
| 3 | Python capture | Import hook + AST rewrite | Sync, async, FastAPI, Django golden traces |
| 4 | Node/TS capture | `Module._compile` + ESM `--import` loader + swc | CJS, ESM, ts-node, tsx, Express, Next.js golden traces |
| 5 | Auto-detect + UX | `flowtrace run -- <cmd>` lang sniff + unified output | One command 4 langs |
| 6 | Hardening + perf | CI matrix, overhead bench < 15%, source maps | All golden tests green, bench passes |
| 7 | Docs + release | README rewrite, migration v1→v2, tag v2.0.0 | npm/maven/pypi packages published |

---

## Sprint Detail + Acceptance Checks

### Sprint 0 — Foundation

**Tasks**
- Branch `legacy/v1` ← current `main`. Branch `v2/main` from `main`.
- Move `agents/{go,rust,dotnet}` + `flowtrace-agent/` (Java old custom) + `flowtrace-agent-js/` to `legacy/`.
- Create `schema/flowtrace-v2.json` (JSON Schema draft 2020-12).
- `examples/golden/` per lang (java, python, node, ts) — sample app + expected JSONL fragment.
- Repo-level `Makefile` or `taskfile.yml` with `make build`, `make test`, `make bench`.

**Checks**
- [ ] `git branch --list` shows `legacy/v1` and `v2/main`
- [ ] `legacy/` dir contains old agents
- [ ] `schema/flowtrace-v2.json` validates each `examples/golden/*/expected.jsonl`
- [ ] `make test` runs (empty pass OK)
- [ ] CI workflow `.github/workflows/v2-ci.yml` skeleton exists

**Risk**: schema additions later require version bump → freeze schema only when consumers ready (sprint 1).

---

### Sprint 1 — Consumers refactor

**Tasks**
- `mcp-server/`: update `types.ts` to v2. New tools:
  - `trace_tree(trace_id)` — hierarchical call tree
  - `trace_find_error(session)` — first exception + path from root
  - `trace_private_calls(session)` — filter by `visibility=private`
  - `trace_diff(session_a, session_b)` — regression compare
- `flowtrace-dashboard/`: `analyzer/` reads v2 fields, charts use `duration_ns`, group by `trace_id`.
- `flowtrace-cli/`: simplify commands → `init`, `run`, `analyze`. Remove per-lang install (auto in `run`).

**Checks**
- [ ] `cd mcp-server && npm run build` ok
- [ ] MCP tool `trace_tree` returns nested structure for sample golden trace
- [ ] Dashboard renders chart from `examples/golden/java/expected.jsonl`
- [ ] `flowtrace run --help` shows 3 commands only
- [ ] Unit tests cover schema migration path v1→v2 (fail soft on unknown fields)

---

### Sprint 2 — Java capture (OTel-Java)

**Tasks**
- New `capture/java/`. Maven module `flowtrace-otel-extension`.
- Bundle `opentelemetry-javaagent.jar`. Extension implements `AutoConfigurationCustomizerProvider` registering custom `SpanExporter` → JSONL v2.
- Method matcher includes private (`AbstractInstrumenter` API). Filter via `flowtrace.package-prefix` system property.
- CLI: `flowtrace run --java -- java -jar app.jar` injects `-javaagent:capture/java/target/flowtrace-otel.jar -Dotel.javaagent.extensions=...`.

**Checks**
- [ ] `mvn package` builds `flowtrace-otel.jar`
- [ ] `flowtrace-example/` Spring Boot app traced — golden contains private method
- [ ] JSONL conforms to schema v2 (auto-validate in test)
- [ ] No source change required to instrument
- [ ] `trace_id`/`span_id` are W3C-format hex
- [ ] Overhead measurement: < 15% on a 10k req/s benchmark (record baseline)

**Risk**: OTel extension API may not expose private-method instrumentation directly. **Spike day 1**: prototype private capture. If blocked → fallback to ByteBuddy direct premain (lose OTel correlation, keep depth).

---

### Sprint 3 — Python capture

**Tasks**
- New `capture/python/`.
- `flowtrace_runtime/finder.py`: `importlib.abc.MetaPathFinder` + `Loader` filtering by prefix.
- `flowtrace_runtime/transformer.py`: `ast.NodeTransformer` wrapping every `FunctionDef`/`AsyncFunctionDef`/`Lambda` with trace enter/exit. Preserve decorators, type hints, source maps via `ast.fix_missing_locations` + `compile(filename=...)`.
- `flowtrace_runtime/profile.py`: `sys.setprofile` fallback for C-extensions/builtins (opt-in).
- Bytecode cache `~/.flowtrace/cache/py/<hash>.pyc`.
- CLI: `flowtrace run --python -- python app.py` sets `PYTHONSTARTUP=<bootstrap.py>` registering finder.

**Checks**
- [ ] Sync script (single file) → all functions including `_private` traced
- [ ] FastAPI app → async handler `await` boundaries captured (`enter` async, `exit` async with full `duration_ns`)
- [ ] Django app → request → view → ORM call captured, private helpers visible
- [ ] Source files on disk byte-identical post-run (no mutation)
- [ ] Cache hit on second run (no re-AST cost)
- [ ] Stack traces in `error.stack` map to original line numbers

**Risk**: AST rewrite breaks frameworks doing introspection. Spike: pytest, FastAPI dependency injection. Mitigation: skip files matching deny-list patterns.

---

### Sprint 4 — Node/TS capture

**Tasks**
- New `capture/node/`.
- **CJS path**: hook `Module.prototype._compile` → parse with `swc` (`@swc/core`) → traverse AST inserting trace wrapper around `FunctionDeclaration`, `FunctionExpression`, `ArrowFunctionExpression`, `MethodDefinition`, class private fields (`#m`) → re-emit + source map.
- **ESM path**: `loader.mjs` exporting `load(url, ctx, next)` → fetch source → swc transform → return transformed. Activated via `--import file:///.../bootstrap.mjs` (Node 20.6+).
- **TS**: same path. swc syntax `{ syntax: "typescript", tsx: true, decorators: false }`.
- **Workers**: propagate `--import` via `process.execArgv`.
- Cache transformed code at `~/.flowtrace/cache/node/<hash>.{js,map}`.
- CLI: `flowtrace run -- node app.js` / `flowtrace run -- ts-node app.ts` / `flowtrace run -- tsx app.ts` / `flowtrace run -- next dev`.

**Checks**
- [ ] CJS Express app: nested non-exported helpers traced
- [ ] ESM module with top-level `await` traced
- [ ] TS file with classes + arrow functions: all methods incl. private `#field` traced
- [ ] Next.js dev: API route + Server Component traced
- [ ] Worker thread: independent trace stream with shared `trace_id`
- [ ] Source map reverse-mapping yields original `.ts` line numbers in errors
- [ ] No `tsconfig` change required
- [ ] No decorator anywhere in user code

**Risk**: bundlers (webpack/vite) pre-transform. Doc constraint: dev-time only for MVP. Production builds = post-MVP story.

---

### Sprint 5 — Auto-detect + UX

**Tasks**
- `flowtrace-cli/lib/detect.js`: sniff cwd for `pom.xml`, `pyproject.toml`/`requirements.txt`, `package.json` (+ `tsconfig.json`).
- Subcommand routing: `flowtrace run -- <cmd>` → detect lang → invoke appropriate launcher.
- Output to `.flowtrace/<ISO-timestamp>.jsonl` (auto `.gitignore`).
- `flowtrace analyze [--last|<file>]` → spawns MCP server + dashboard.

**Checks**
- [ ] `cd <java repo> && flowtrace run -- mvn spring-boot:run` works
- [ ] `cd <py repo> && flowtrace run -- python -m app` works
- [ ] `cd <ts repo> && flowtrace run -- npm run dev` works
- [ ] Ambiguous repo (multi-lang) prompts for choice
- [ ] `flowtrace analyze --last` opens dashboard at most-recent JSONL

---

### Sprint 6 — Hardening + perf

**Tasks**
- CI matrix: lang × (sync, async, threaded) × framework.
- Bench harness: 10k call hot loop per lang, measure overhead vs baseline.
- Source map propagation end-to-end test.
- Truncation parity tests (golden) across 4 langs.

**Checks**
- [ ] CI green on all matrix cells
- [ ] Java overhead < 15%
- [ ] Python overhead < 20% (AST baseline higher)
- [ ] Node overhead < 15%
- [ ] TS overhead < 18%
- [ ] Truncation `max-arg-length=512` produces identical truncation marker across langs
- [ ] Memory: trace buffer flush keeps RSS bounded under 1h continuous load

---

### Sprint 7 — Docs + release

**Tasks**
- README rewrite: one page, one command, screenshot of dashboard.
- `docs/architecture.md`: 3 layers + decisions log.
- `docs/migration-v1-v2.md`: schema diff + flag `--schema-v1` for 3 releases.
- Publish: npm `@flowtrace/cli`, `@flowtrace/capture-node`, `@flowtrace/mcp-server`. Maven Central `io.flowtrace:flowtrace-otel:2.0.0`. PyPI `flowtrace-runtime`.
- Tag `v2.0.0`. GitHub release notes.

**Checks**
- [ ] README under 200 lines, single quickstart block
- [ ] Migration doc has table v1 field → v2 field
- [ ] `npm install -g @flowtrace/cli && flowtrace run -- <cmd>` works fresh box
- [ ] `pip install flowtrace-runtime` resolves
- [ ] Maven coordinate resolves
- [ ] Tag `v2.0.0` pushed; GitHub release draft

---

## Cross-Sprint Hard Rules

1. **Zero source modification.** Any sprint introducing a decorator, annotation, or required `import` from user code = rejected.
2. **Schema v2 frozen** after Sprint 1. Additions require minor version bump, never field rename.
3. **Validation gate** every sprint: build + lint + type-check + tests + schema-validate.
4. **No commit before validation passes.** No `--no-verify`.
5. **Legacy branch read-only**. v1 patches only for security CVEs.

## Deferred (post-MVP)

- Go AST rewrite (`legacy/v1/agents/go/`)
- Rust proc-macro (`legacy/v1/agents/rust/`)
- .NET Source Generator (`legacy/v1/agents/dotnet/`)
- eBPF / Frida L0 capture for stripped native binaries
- Distributed tracing cross-process (schema supports, no implementation)
- Production-build instrumentation (post-bundler source-map-aware)

## Open Questions

1. OTel extension private-method capture — confirm Sprint 2 day 1 spike.
2. swc vs babel — bench startup; default swc unless plugin gap found.
3. Cache invalidation key — content hash + capture version + lang version.

## Continuity

Next session entry point: Sprint 0. See `next_task` MCP record.
