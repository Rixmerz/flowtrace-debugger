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

## Tests

```bash
make test-python        # pytest tests/
```
