# flowtrace-runtime (Python capture layer)

The Python capture layer of FlowTrace v2. It is **not published on PyPI**:
`@rixmerz/flowtrace` (the CLI) vendors this directory, puts it on
`PYTHONPATH` and lets the `sitecustomize` stub do the rest, so
`flowtrace run -- python app.py` is the supported way to use it. No `pip`.

## How it attaches

1. `stub/sitecustomize.py` runs at interpreter start (it is on `PYTHONPATH`)
   when `FLOWTRACE_ENABLE=1`, and calls `flowtrace_runtime.install()`.
2. `install()` puts a `MetaPathFinder` (`finder.py`) at the head of
   `sys.meta_path`. Every import whose module name matches
   `FLOWTRACE_PACKAGE_PREFIX` is loaded by `loader.py`, which parses the
   source, rewrites the AST (`transformer.py`) so each function body calls
   `_ft_enter` / `_ft_exit` / `_ft_exit_error` (`runtime.py`), compiles it,
   and caches the bytecode under `~/.flowtrace/cache/py` (mode `0700`).
3. The main script is not an import, so the stub transforms and executes it
   itself, then ends the interpreter the way `python script.py` would:
   non-daemon threads joined, `atexit` handlers run, stdout/stderr flushed,
   and the program's own exit status (a `sys.exit(3)` exits 3, an uncaught
   exception prints its traceback and exits 1).

Context propagation is `contextvars`. `asyncio` tasks inherit it natively;
`threading.Thread.start` is patched so a thread (and every
`ThreadPoolExecutor` worker) inherits the span that started it too.

## Knobs

| Variable | Meaning |
|---|---|
| `FLOWTRACE_OUTPUT` | Output path. Default `.flowtrace/<timestamp>.<ms>-<pid>.jsonl` under cwd. |
| `FLOWTRACE_PACKAGE_PREFIX` | Comma-separated module prefixes to instrument (`myapp` matches `myapp` and `myapp.*`). **Required in practice** — unset, nothing is instrumented. The main script matches when its basename is the prefix or when it lives under a directory named like the prefix's first component (`src/myapp/main.py`). |
| `FLOWTRACE_MAX_ARG_LENGTH` | Per-value limit on the JSON form of each argument and of the result; `0` disables. Default 512. Over the limit the value becomes `<truncated:{first N chars}...>`. |
| `FLOWTRACE_REDACT_KEYS` | Extra key substrings to redact, comma-separated. Additive to the defaults (`password, secret, token, authorization, api_key, url, dsn, connection_string, email`); a matching argument name or nested dict key is written as `<redacted>`. |
| `FLOWTRACE_TRACEPARENT` | A W3C `traceparent` to adopt at startup, set by whatever spawned this process. |
| `FLOWTRACE_ROOT` | Project root the `file` field is relative to. Default: the cwd when the capture layer loads. A relative value is resolved against that cwd. |

## What the events look like

- `lang` is `python`; `thread` is the thread's name.
- `module` is the file's stem; `class` is the enclosing class or `""`.
- `visibility` is `private` for `__dunder`-less double-underscore names,
  `internal` for a single leading underscore, `public` otherwise.
- `args` are the function's parameters (`self`/`cls` excluded).
- `result` is `{"value": X}` for any non-`None` return — a `dict` return is
  wrapped like everything else — and `{}` for `None` or for a call that
  raised (then `error` is set). Values JSON cannot carry are recorded as
  their `repr()`; `NaN`/`Infinity` become strings so the line stays valid
  JSON.
- Docstrings, `__name__`, `__qualname__` and `__file__` of instrumented code
  are preserved.

## `file` and `line`

Every `enter` event ends with the place the function is declared, so a static
index can join the span to its symbol; `exit` events do not carry them.

- `file` is the source file as a POSIX path relative to the project root —
  `FLOWTRACE_ROOT` if set, else the cwd the process started in. A file outside
  the root is reported by its absolute path. Run from the repository root, or
  set `FLOWTRACE_ROOT` to it, if the consumer indexes paths from there.
- `line` is the 1-indexed line of the `def` / `async def` as written on disk.
  For a decorated function it is the `def` line, not the first decorator.
  Nested functions report their own `def` line.
- Both are literals baked in when the module is transformed (`node.lineno`
  read from the parsed AST before the body is rewritten), not computed per
  call. They are never redacted and never truncated.
- The bytecode cache is keyed on the resulting `file`, so tracing the same
  sources under another root does not serve a stale path.
- Each process resolves its own root: a child started in another directory
  reports paths relative to *its* cwd unless `FLOWTRACE_ROOT` is set (the
  variable is inherited through the environment like any other).
- A manual `_ft_enter(...)` call that omits the two arguments produces an
  event without them.

## Cross-process tracing is partly manual

Inbound `FLOWTRACE_TRACEPARENT` is adopted automatically. **An inbound HTTP
header is not**: wrap the request yourself.

```python
from flowtrace_runtime import remote_context, current_traceparent

with remote_context(request.headers.get("traceparent")):
    handle(request)

# Outbound: attach current_traceparent() to the request you make.
```

That import only resolves under `flowtrace run`; guard it with
`try/except ImportError` if the same code also runs uninstrumented.

## Guarantees to the traced program

- Nothing in the instrumentation raises into user code. A write failure (an
  unwritable `FLOWTRACE_OUTPUT`, a full disk) is reported once on stderr and
  counted; the count is printed at exit.
- A forked child gets its own lock and file handle (`os.register_at_fork`).
- The program's exit status, `atexit` handlers and thread joins are preserved
  (see above).

## Spans the program did not cause

- **Serialisation is not a call.** Rendering `args`, `result` and `error` runs
  the program's own `__repr__` / `__str__`. While that happens, instrumented
  functions invoked by the capture layer emit no span and leave the span
  context alone (a `ContextVar` guard in `runtime.py`, per thread and per
  asyncio task; one `ContextVar.get` per instrumented call). The text still
  appears in the trace. A `__repr__` your own code calls is traced as usual.
- **What the span of a generator means.** A generator function's span opens at
  the first `next()` and closes when the body finishes, raises or the generator
  is closed, so its duration covers creation to exhaustion. It is the *current
  parent* only while its own frame is executing: at every `yield` the context
  the consumer had is restored, and re-entered when the consumer resumes it.
  So the body of `with some_contextmanager():` and code between `next()` calls
  belong to the real caller. Same for async generators. Limitation: a
  `yield from sub()` pauses the outer span while `sub` runs, so spans inside an
  instrumented `sub` are attributed to whoever drives the outer generator.

## Tests

```bash
make test-python        # pytest tests/
```
