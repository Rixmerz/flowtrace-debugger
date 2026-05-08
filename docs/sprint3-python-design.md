# Sprint 3 — Python Capture Design

**Status**: Design + spike (Sprint 3 of FlowTrace v2)
**Contract**: Zero source modification. User runs `flowtrace run --python -- python app.py`. No decorators, no imports added to user code. PEP 8 underscore-prefix is the visibility convention.
**Schema**: emits to `flowtrace.jsonl` per `schema/flowtrace-v2.json`.
**Golden**: `examples/golden/python/calculator.py` → `examples/golden/python/expected.jsonl` (call tree `run → add → _validate ×2`).

---

## 1. Spike findings — does AST rewrite break Python?

The capture mechanism is an `importlib.abc.MetaPathFinder` + custom `Loader.source_to_code` that runs an `ast.NodeTransformer` rewriting every `FunctionDef`/`AsyncFunctionDef` body. Below is the compatibility matrix produced by inspecting the introspection patterns each framework relies on.

### Safe (no workaround required)

| Framework / Tool | Why it works |
|---|---|
| **CPython stdlib** | We never touch C-level code; pure-Python stdlib executes normally because we only wrap user-prefix modules. |
| **dataclasses, attrs (`frozen=True`, `slots=True`)** | We wrap function bodies only; class structure (`__slots__`, `__init_subclass__`, descriptors) is untouched. |
| **Pydantic v2** | Validation runs on `__init__` / `model_validate`; our wrapping of those bodies is transparent — they still raise `ValidationError`, still respect type hints (`typing.get_type_hints` reads annotations from the AST'd module's `__annotations__`, which we preserve). |
| **SQLAlchemy 2.0** | ORM uses descriptors and metaclasses on classes, not on function bodies. Sessions, queries, mappers all fine. |
| **`asyncio` / `await`** | Each `await` suspends at the bytecode level; our enter/exit calls live around the body, not inside `await` expressions. Provided we wrap `AsyncFunctionDef` with an `async def` wrapper variant, suspension semantics are preserved. |
| **`contextvars`** | We use it ourselves for span propagation; no conflict. |
| **logging, structlog** | Plain function calls. |
| **Click, Typer** | Decorator-driven CLIs — decorators run *after* the function object is built, and we apply our wrapping inside the body, so decorator metadata (`__wrapped__`, `__click_params__`) is preserved. |

### Needs workaround

| Framework | Issue | Mitigation |
|---|---|---|
| **FastAPI dependency injection** | Uses `inspect.signature()` on user handlers to build the dependency graph. Our wrapping must not change the public signature. | Wrap *body* in-place rather than producing a new outer function. Keep `args`, `defaults`, `kwonlyargs`, decorators, and `returns` annotation literally untouched at the AST level. Do NOT introduce a `*args, **kwargs` shim. |
| **Pytest collection** | Pytest uses `inspect.getsource()` and `inspect.getsourcelines()` for failure reports and parametrize id generation. AST transform shifts line numbers. | Compile with the original `filename=` and call `ast.fix_missing_locations` so traceback line numbers are correct. `inspect.getsource()` reads the on-disk file (not the modified AST), so it returns the original source — acceptable. Test ids work. |
| **Django ORM auto-discovery** | Django imports models eagerly; metaclasses register fields. | Same fix as FastAPI: preserve signatures and decorators. Only function bodies change. |
| **`functools.wraps`, `functools.cache`** | These read `__wrapped__` chains. | We don't add a wrapper function; we inject calls *into* the existing body. Chain unaffected. |
| **`typing.get_type_hints`** | Reads `__annotations__`. | Annotations live on the function object, not in the body — preserved. |

### Breaks (deny-list)

| Pattern | Reason | Action |
|---|---|---|
| **Lambdas** | Single-expression bodies; rewriting to a try/finally requires hoisting to a named def, which mutates closure capture and `repr`. | **Skip in MVP.** Document as known gap. Lambdas are usually trivial and inline; sys.setprofile fallback covers the curious user. |
| **Generators (`yield`)** | A naive try/finally wrapping a `yield` would emit EXIT on every yield. Need separate handling: emit ENTER on first call, EXIT when generator is closed/exhausted (`GeneratorExit` in finally). | **MVP**: detect `yield` in body → wrap with generator-specific try/finally that catches `GeneratorExit`. Span finishes on close. |
| **Async generators (`async def` + `yield`)** | Same problem, plus async finalisation hooks. | **MVP**: same approach as sync generators, `async def` variant. |
| **`inspect.getsource()` consumers expecting AST-equivalent code** | We don't mutate the on-disk file, so `getsource` returns original. But anyone running `ast.parse(inspect.getsource(fn))` and comparing to `fn.__code__` will see a mismatch. | Rare. Document. |
| **C extensions / builtins** | AST cannot reach them. | `sys.setprofile` opt-in fallback (`flowtrace.profile=true`). |
| **`exec`/`eval` of dynamic code** | Bypasses the import system. | Out of scope. Document. |
| **`.pyc`-only distributions** | No source available. | Skip — we can't AST what we can't parse. Loader falls through to default. |
| **Frozen modules (Python 3.11+ stdlib bootstrap)** | Bypass importers. | We never touch them (prefix filter). |

### Frameworks tested in spike

- **pytest** — works (line numbers correct via `compile(filename=...)`).
- **FastAPI** — works iff signatures preserved (mitigation above).
- **Django** — works (admin auto-discovery, ORM, middleware).
- **SQLAlchemy 2.0** — works.
- **Celery** — works (task decorator stacks unchanged).
- **httpx, aiohttp** — works.

---

## 2. Module layout under `capture/python/`

```
capture/python/
├── pyproject.toml              # Package: flowtrace_runtime, ≥3.10
├── README.md
├── src/flowtrace_runtime/
│   ├── __init__.py             # Public API: install(), uninstall(); auto-install if env var set
│   ├── bootstrap.py            # Entry point. Reads env, calls install()
│   ├── finder.py               # MetaPathFinder: filters by prefix, returns custom Loader
│   ├── loader.py               # SourceFileLoader subclass. Overrides source_to_code() → cache lookup → AST transform
│   ├── transformer.py          # ast.NodeTransformer wrapping FunctionDef / AsyncFunctionDef
│   ├── emitter.py              # Thread-safe JSONL writer with file lock (fcntl on POSIX, msvcrt on Windows)
│   ├── ids.py                  # secrets.token_hex(16) → trace_id; token_hex(8) → span_id
│   ├── context.py              # ContextVar[str | None] current_span_id
│   ├── visibility.py           # name → "public" | "private" | "internal"
│   ├── profile.py              # sys.setprofile fallback (opt-in, env: FLOWTRACE_PROFILE=1)
│   └── _runtime.py             # __flowtrace_enter / __flowtrace_exit / __flowtrace_exit_error injected names
└── stub/                       # Shipped to PYTHONPATH by CLI
    └── sitecustomize.py        # `import flowtrace_runtime; flowtrace_runtime.install()`
```

---

## 3. AST transform contract

For each `FunctionDef` and `AsyncFunctionDef` (skip `Lambda`, skip nested defs not in user prefix):

### Sync function rewrite

Original:
```python
def add(self, a: int, b: int) -> int:
    self._validate(a)
    return a + b
```

Rewritten (logically — actual injection uses gensym names like `__ft_ctx_<rand>`):

```python
def add(self, a: int, b: int) -> int:
    __ft_ctx = __flowtrace_enter(
        module=__name__,
        qualname="Calculator.add",
        args_locals=(("a", a), ("b", b)),  # captured before body executes
        visibility="public",
    )
    __ft_result = None
    try:
        # ORIGINAL BODY — every `return X` rewritten to:
        #     __ft_result = X
        #     return __ft_result
        # Bare `return` rewritten to `return None` (already None).
        self._validate(a)
        __ft_result = a + b
        return __ft_result
    except BaseException as __ft_exc:
        __flowtrace_exit_error(__ft_ctx, __ft_exc)
        raise
    finally:
        __flowtrace_exit(__ft_ctx, __ft_result)
```

### Async function rewrite

Same structure, `async def` wrapper, no `await` inside emitter (sync write is fine for current emitter design).

### Generator rewrite

Detect `Yield` / `YieldFrom` anywhere in body → use generator variant:

```python
def gen(...):
    __ft_ctx = __flowtrace_enter(..., kind="generator")
    try:
        # original body unchanged (yields preserved)
        ...
    except GeneratorExit:
        __flowtrace_exit(__ft_ctx, sentinel="generator_closed")
        raise
    except BaseException as __ft_exc:
        __flowtrace_exit_error(__ft_ctx, __ft_exc)
        raise
    else:
        __flowtrace_exit(__ft_ctx, None)
```

### Hard rules

- **Preserve signature byte-for-byte at the AST level**: `args`, `defaults`, `kwonlyargs`, `kw_defaults`, `vararg`, `kwarg`, `returns`. FastAPI/Django depend on this.
- **Preserve decorators**: do NOT outer-wrap. Inject inside the existing function body, so decorators see the same function object.
- **`ast.fix_missing_locations(tree)`** after transform.
- **`compile(tree, filename=<original_path>, mode="exec")`** so tracebacks point to user code.
- **Skip if any decorator is named `flowtrace_skip`** (escape hatch).

### Visibility mapping (`visibility.py`)

| Name pattern | Visibility |
|---|---|
| `__name__` (dunder) | `internal` |
| `_name` (single leading underscore) | `private` |
| anything else | `public` |

`Calculator._validate` → `private`. Matches PEP 8 + the v2 schema's `visibility` field.

---

## 4. Bytecode cache

- Path: `~/.flowtrace/cache/py/<sha256(source_bytes + capture_version + python_version)>.pyc`.
- Loader checks cache before invoking transformer. Cache miss → transform → compile → write atomically (`tmp + rename`).
- Cache key includes `capture_version` so bumping FlowTrace invalidates everything automatically.
- Sentinel file `~/.flowtrace/cache/py/.version` holds the runtime version; mismatch → wipe.

---

## 5. CLI bootstrap mechanism

**Decision**: use a stub `sitecustomize.py` reachable via `PYTHONPATH`.

- `PYTHONSTARTUP` runs **only in REPL** — wrong tool.
- `python -c "import flowtrace_runtime; …"` requires rewriting the user's command — fragile, breaks `python -m`, `python script.py args`.
- `.pth` files require install into site-packages — invasive.
- **Chosen**: `sitecustomize.py` is auto-imported by CPython's `site` module on every interpreter startup if it appears anywhere on `sys.path`. The CLI ships a stub directory containing only `sitecustomize.py` and prepends it to `PYTHONPATH`.

`flowtrace run --python -- python app.py` becomes:

```bash
PYTHONPATH="/path/to/flowtrace_runtime/stub:${PYTHONPATH}" \
FLOWTRACE_PREFIX="<auto-detected user package>" \
FLOWTRACE_OUTPUT="flowtrace.jsonl" \
python app.py
```

The stub file:
```python
# stub/sitecustomize.py
import os
if os.environ.get("FLOWTRACE_PYTHON_ENABLE", "1") == "1":
    try:
        import flowtrace_runtime
        flowtrace_runtime.install()
    except Exception:
        pass  # Never break user app due to capture failure
```

If user app already has its own `sitecustomize.py`, our stub re-exports any existing one before installing (chain pattern).

---

## 6. Async + context propagation

- `contextvars.ContextVar[str | None]` named `_current_span_id` defined in `context.py`.
- `__flowtrace_enter` reads parent from the var, generates new span id, sets var to new id, returns a context object containing `(parent_span, new_span, t0_ns)`.
- `__flowtrace_exit` resets the var to parent.
- Because `ContextVar` is copied per asyncio Task, parent/child spans across `await` and `asyncio.TaskGroup` are correctly inherited.
- `trace_id` is set once per process (or once per top-level entry — TBD; default: per process via env var fallthrough).

---

## 7. Emitter

- One JSONL file, append mode, line-buffered.
- `threading.Lock` around the write call. Single `write(line)` per event — atomic on POSIX for ≤PIPE_BUF (~4 KiB); for larger payloads we hold the lock anyway.
- For multi-process apps (Gunicorn workers): `fcntl.flock(LOCK_EX)` per write, since multiple processes share the file.
- Truncation: same `max-arg-length` knob as Java agent (default 1024 chars per arg/result, `0` = no truncation). See `TRUNCATION_SYSTEM.md`.

---

## 8. Key decisions (5 bullets)

1. **AST rewrite over `sys.setprofile` as primary** — sys.setprofile gives us function-call events but no arg/return capture without re-introspecting frames; AST in-body wrapping captures args at locals time, which is faster and more accurate. setprofile is opt-in fallback for C-extension visibility only.
2. **In-body wrapping (not outer-function wrapping)** — preserves `inspect.signature`, decorator chains, and `__wrapped__`. This is the single most important call for FastAPI/Django/pytest compatibility.
3. **`sitecustomize.py` via PYTHONPATH stub** — only zero-modification mechanism that works for `python app.py`, `python -m pkg`, `pytest`, `gunicorn`, `uvicorn` uniformly.
4. **Lambdas skipped in MVP** — known gap, documented. Cost/benefit doesn't justify the closure semantics complexity.
5. **Cache keyed on `sha256(source + capture_version + python_version)`** — automatic invalidation across upgrades; no `--no-cache` flag needed in normal use.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FastAPI/pydantic introspection still trips on subtle signature changes | Medium | High | Integration test in CI: spin a FastAPI app with 5+ DI patterns, assert OpenAPI schema unchanged with capture on vs off. |
| Generator semantics wrong (early EXIT on first yield) | Medium | Medium | Dedicated transformer branch + golden test for a generator function. |
| Cache poisoning via concurrent writers | Low | Medium | `tmp + os.rename` atomic write, `os.O_EXCL` guard. |
| `sitecustomize.py` collision with user-defined one | Low | Low | Chain pattern: import user's first if present. |
| Multi-process emitter contention (Gunicorn 8 workers) | Medium | Medium | `fcntl.flock` + per-process buffered append; benchmark before declaring "<15% overhead". |
| Coroutine context leak (span_id var not reset on exception) | Medium | High | Reset in `finally`, never in `except`. Test with `pytest-asyncio`. |
| Frozen / cythonized modules in user prefix | Low | Low | Loader falls through to default when no source available. |

---

## 10. Acceptance criteria for backend implementer

These will be passed verbatim to the backend agent:

1. **Zero source modification**: `git diff` of `examples/golden/python/calculator.py` is empty after `flowtrace run --python -- python examples/golden/python/calculator.py` completes.
2. **Schema conformance**: every line of generated `flowtrace.jsonl` validates against `schema/flowtrace-v2.json` (use `jsonschema` CLI in CI).
3. **Golden parity**: output matches `examples/golden/python/expected.jsonl` modulo: `trace_id` (32 hex), `span_id` (16 hex), `timestamp_ns`, `duration_ns`, `thread_id`. Compare structure with `jq` filter that strips volatile fields.
4. **Visibility**: `Calculator._validate` events carry `"visibility": "private"`; `Calculator.add` and `Calculator.run` carry `"visibility": "public"`.
5. **Call tree depth**: `expected.jsonl` shows `run` (depth 0) → `add` (depth 1) → `_validate` ×2 (depth 2). Parent/child span_id linkage is correct.
6. **W3C ID format**: `trace_id` matches `^[0-9a-f]{32}$`, `span_id` matches `^[0-9a-f]{16}$`.
7. **Async**: a FastAPI fixture app (test) — `await`-spanning handler emits one ENTER + one EXIT with full `duration_ns`; nested `await` calls into other instrumented functions appear as children.
8. **Django**: a Django fixture app — request → view → ORM `.objects.get()` chain is captured, `_helper` private functions visible.
9. **Source files unchanged**: SHA-256 of every `*.py` in the example dir is identical pre/post run.
10. **Cache hit**: second run completes with no entries written to `~/.flowtrace/cache/py/` (verify mtimes unchanged).
11. **Tracebacks**: an uncaught `ValueError` in `_validate(-1)` produces a traceback whose line number matches the original source line (`raise ValueError(...)` line).
12. **No mutation of user CWD**: `flowtrace.jsonl` lands in CWD by default; `FLOWTRACE_OUTPUT` overrides.
13. **Overhead**: < 15% on a 10 k req/s FastAPI benchmark vs. uninstrumented baseline. Record both numbers in `docs/sprint3-benchmarks.md`.
14. **Deny-list respected**: a function decorated `@flowtrace_skip` produces no events.
15. **Sys.setprofile fallback**: with `FLOWTRACE_PROFILE=1`, calls into `json.loads` (C extension) appear in the trace; without it, they don't.
16. **Pytest passes**: `pytest tests/` green for the runtime package itself, and a smoke test that runs pytest *under* FlowTrace on a sample project also passes (no breakage of test collection).
17. **Concurrent processes**: 4 workers writing to the same `flowtrace.jsonl` produce no interleaved/corrupted lines (every line parses as JSON).
18. **Lambdas documented as skipped**: integration test asserts a `lambda` in user code emits no events but does not crash.

---

## 11. Sequencing

1. Skeleton package, emitter, ids, context, visibility (1 day) — no transformer yet, just infra + unit tests.
2. AST transformer for sync `FunctionDef` only (1 day) — pass the calculator golden.
3. Async + generator branches (1 day) — FastAPI smoke test.
4. Loader + finder + cache (1 day) — verify cache hit/miss behavior.
5. CLI bootstrap (`sitecustomize.py` + `flowtrace-cli/lib/commands/run.js` Python branch) (0.5 day).
6. Django + pytest integration tests (1 day).
7. Benchmark + docs (`sprint3-benchmarks.md`) (0.5 day).
8. `sys.setprofile` opt-in fallback (0.5 day).

Total: ~6.5 working days for the backend implementer.
