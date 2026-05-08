# FlowTrace v2 — Estado actual + Handoff post-release

**Branch**: `v2/main` (publicada). Tag: `v2.0.0`. Commit head: `55d7ffb`.
**CI**: 9/9 jobs verde en `.github/workflows/v2-ci.yml`.
**Date**: 2026-05-08.

---

## Estado actual

### Sprints completados

| # | Commit | Entregable |
|---|---|---|
| 0 | `0019951` | Branch split, schema v2, goldens, CI base |
| 1 | `a42f8e7` | mcp-server v2 tools, dashboard, slim CLI |
| 2 | `6ef0a0e` | Java capture (OTel-Java + ByteBuddy) |
| 3 | `15ab396` | Python capture (importlib + AST) |
| 4 | `6565e9f` | Node/TS capture (Module._compile + ESM + babel) |
| 5 | `a74db2b` | Auto-detect + slim UX |
| 6 | `3dd0a60` | CI matrix, bench, truncation, source maps |
| 7 | `2a82d6b` | Docs, migration, packages → 2.0.0, tag |
| post | `c412df9` | Demo `fastapi-bugged` + fix python error nesting |

### Test totales (~166 tests)

- Schema validation: 32/32 events
- Java: 5/5 (4 emitter + 1 integration)
- Python: 30/30 (incluye regression test_error_shape)
- Node: 21/21
- mcp-server: 6/6
- Dashboard: 1/1
- CLI: 72 (test-cli + java + python + node + detect + autodetect + analyze)

### Layout repo (post-v2)

```
capture/
  java/flowtrace-otel-extension/     # Maven module, shaded uber-jar
  python/                             # flowtrace-runtime + stub
  node/                               # @flowtrace/capture-node
flowtrace-cli/                        # @flowtrace/cli
flowtrace-dashboard/                  # @flowtrace/dashboard
mcp-server/                           # @flowtrace/mcp-server
schema/flowtrace-v2.json              # JSON Schema 2020-12
examples/golden/{java,python,node,ts}/
demo/fastapi-bugged/                  # End-to-end demo (3 bugs L1/L2/L3)
benchmarks/                           # Bench harness (informational)
docs/
  architecture.md
  migration-v1-v2.md
  release-notes-v2.0.0.md
  sprint{2,3,4}-design.md
  HANDOFF_V2.md                       # Plan original
  HANDOFF_V3.md                       # Este doc
legacy/                               # v1 agents (go/rust/dotnet, java old, node old)
```

### MCP server registrado en jig

```
proxy_add name=flowtrace command=node \
  args=[/.../mcp-server/dist/server.js]
```

8 tools embedded: `log.open`, `log.search`, `log.aggregate`, `log.schema`,
`trace.tree`, `trace.find_error`, `trace.private_calls`, `trace.diff`.

---

## Bugs cazados durante desarrollo

Lista para futuras sesiones — patrones que reviewer/demo encontraron:

1. **Java ts en ms no segundos** — schema permitía (sin bounds), reviewer caught.
2. **Schema sin bounds epoch** — agregado `[1e9, 1e10]`.
3. **Jackson annotations en helper class** — invisibles desde advice classloader.
4. **Python PYTHONPATH faltante** — usuario real no recibía traces (test usaba PYTHONPATH explícito).
5. **GeneratorExit como error** — lifecycle normal, no error.
6. **Node babel visitor recursión** — sentinel `_flowtraceWrapped` + `path.skip()`.
7. **Node ESM source variants** — string|Buffer|undefined per Node version.
8. **Python error nested en result.error** — schema permitía (loose result), MCP find_error perdía. Demo lo cazó.

---

## Pendiente / Roadmap futuro

### Inmediato (publicación)

- [ ] `npm publish` workspaces: `@flowtrace/cli`, `@flowtrace/capture-node`, `@flowtrace/mcp-server`, `@flowtrace/dashboard`.
- [ ] `pip publish` `flowtrace-runtime` (twine + PyPI account).
- [ ] Maven Central deploy `io.flowtrace:flowtrace-otel-extension:2.0.0` (requiere OSSRH staging).
- [ ] GitHub release notes from `docs/release-notes-v2.0.0.md`.
- [ ] PR `v2/main` → `main` cuando legacy v1 deprecate window venza.

### Hardening real (Sprint 8 candidato)

- [ ] Bench actual con números reales (current harness emite 0ms — fixture demasiado simple).
  Target: < 15% overhead Java/Node, < 20% Python.
- [ ] Memoria bounded bajo carga 1h (RSS no crecer).
- [ ] Multi-process JSONL contention — `fcntl.flock` Python ya, validar Java/Node.
- [ ] Constructor instrumentation (Java/Node skipeados en MVP).
- [ ] Worker thread propagation real test (Node).

### MVP+ (post-2.0)

- [ ] Go AST rewrite revivido en `capture/go/` (port de `legacy/go/`).
- [ ] Rust proc-macro revivido `capture/rust/`.
- [ ] .NET Source Generator revivido `capture/dotnet/`.
- [ ] eBPF/Frida L0 capture para binarios stripped.
- [ ] Distributed tracing cross-process (schema soporta — falta wiring).
- [ ] Production-build instrumentation (post-bundler webpack/vite source-map-aware).
- [ ] Python C extension visibility via `sys.setprofile` fallback (esqueleto existe, no testeado e2e).

### Bugs conocidos / limitaciones

- **Python `_ft_exit_error`**: requiere `pytest -p no:cacheprovider` o limpiar `~/.flowtrace/cache/py` cuando cambias runtime. CACHE invalidation incluye `capture_version` pero no detecta cambios mid-dev.
- **Node `bench`**: numbers son 0ms — fixture simplista. Real bench requiere CPU-bound loop.
- **CLI auto-detect**: `requirements.txt`-only projects fallback a Spanish error. Acceptable MVP, mejorar S5+.
- **Java**: `MAVEN_OPTS` strategy no maneja warnings sobre `-Xshare:auto` cuando JVM levanta.
- **MCP `trace.tree` requires `trace_id` arg** — no hay default "first trace". Considerar agregar.
- **Demo bench `bench` informational**: 0ms en todos langs (fixtures triviales). No bloquea CI pero tampoco aporta señal.

### Deuda técnica

- `mcp-server/dist/` se commitea. Producción debería build-on-publish, no checked-in.
- `flowtrace-cli/vendor/java/opentelemetry-javaagent.jar` requiere `make fetch-deps` manual — usuario fresh-clone no funciona sin esto.
- `capture/python/stub/sitecustomize.py` usa `os._exit(0)` — atexit handlers no corren. Documentado pero hack.
- `legacy/` no tiene CI propio — solo branch `legacy/v1` original conservó workflows.
- Bench results JSONs se commitean accidentalmente (debería gitignore `benchmarks/results-*.json`).

---

## Cómo retomar trabajo

### Setup fresh clone

```bash
git clone https://github.com/Rixmerz/flowtrace-debugger.git
cd flowtrace-debugger && git checkout v2/main
make build-java build-python build-node
cd flowtrace-cli && bash scripts/fetch-otel-agent.sh
make test
```

### Re-registrar MCP en jig

```
proxy_add name=flowtrace command=node \
  args=["<repo>/mcp-server/dist/server.js"]
```

### Validar demo

```bash
cd demo/fastapi-bugged
PYTHONPATH=$PWD:<repo>/capture/python:<repo>/capture/python/stub \
FLOWTRACE_ENABLE=1 FLOWTRACE_PACKAGE_PREFIX=app \
FLOWTRACE_OUTPUT=/tmp/trace.jsonl python3 run_scenarios.py

# luego MCP:
log.open path=/tmp/trace.jsonl
trace.find_error sessionId=...
```

### Patrón delegación validado

Root claude orquesta. Subagents (architect, backend, reviewer, fixer)
no tienen Task tool en su surface — siempre delegar desde root.

Wave pattern por sprint:
1. Wave A paralelo: architect (spike+design) + backend (skeleton agnóstico).
2. Wave B paralelo: backend (capture mechanism) + backend (CLI integration).
3. Wave C: reviewer → fixer → validation suite → commit.

Reviewer agarra bugs que implementer no ve (ej: ts in ms, error nested,
visitor recursion). No skipear esa wave.

---

## Decisiones load-bearing (no revertir sin discusión)

1. **Schema v2 frozen post-Sprint 1**. Cambios → bump $id, nunca rename.
2. **Babel sobre swc visitor** (Node) — swc JS API no expone visitors.
3. **Two JSONL lines per Java span** (enter+exit emit desde advice, no SpanExporter).
4. **In-body wrap Python** (no IIFE/decorator) — preserva inspect.signature.
5. **Bootstrap `--import` Node** — único punto inyección que cubre node/tsx/ts-node/next.
6. **PYTHONPATH-stub `sitecustomize.py`** — único bootstrap que cubre `python app.py`/`-m`/`pytest`/`uvicorn`.
7. **`os._exit(0)` en Python sitecustomize** — necesario para evitar doble exec script. Atexit redundante (flush per-line).
8. **Constructors skip MVP** (Node/Java) — super() ordering complica.
9. **`error` top-level + `result={}` en exit_error path** — schema requires result, MCP needs error top-level.
