# Audit fixes: Python capture + MCP tools

flow: flowtrace-fixes

## Why

Live audit tracing a real Python/FastAPI app (api-businessrules-over-validator)
found bugs across the Python capture layer and the MCP trace-analysis tools.
`__file__` loss (finder.py) is already fixed on `main`; the rest below is not.
Scope here is exactly what was reproduced — no speculative cleanup.

## In scope, each with a reproduction and acceptance criterion

### AC1 — `_ft_exit` must never crash the traced process
`capture/python/flowtrace_runtime/runtime.py` `_ft_exit`: when `result` is a
`dict`, it is passed to `Emitter.emit` unconverted, skipping `_to_json_safe`.
A function returning `dict[str, <non-serializable>]` makes `json.dumps` raise
inside `emit()`, contradicting the emitter's own "never raises" contract, and
kills the app being traced.
Repro: trace a function returning `{"x": SomeObject()}`; process crashes with
`TypeError: Object of type SomeObject is not JSON serializable` originating in
`runtime.py::_ft_exit`.
AC: same repro produces an `exit` event with `result` json-safe (e.g.
`{"x": "<SomeObject repr>"}`), no exception escapes `_ft_exit`, and the child
process's own output/return value is unaffected.

### AC2 — `__pycache__` must not silently disable instrumentation
`capture/python/flowtrace_runtime/loader.py` overrides only `source_to_code`.
`SourceFileLoader.get_code()` returns a cached `.pyc` before calling
`source_to_code` when the cache is fresh, so any module that has ever run
un-instrumented (normal `__pycache__` from dev/CI) traces zero events under
FlowTrace, silently, with exit 0.
Repro: `python -c "import demo_pkg.calc"` once (writes `__pycache__`), then run
the same import under `flowtrace run` — 0 events for `demo_pkg.calc`.
AC: same repro produces >0 events for `demo_pkg.calc` regardless of a
pre-existing fresh `__pycache__`, without requiring `PYTHONDONTWRITEBYTECODE`
or a manual cache clear.

### AC3 — no secrets/PII in emitted args
`_serialize_args`/`_to_json_safe` (`runtime.py`) serialize every local
variable via `repr()`/JSON with no redaction. Tracing a real app captured a
MongoDB connection string with password and 129 email addresses in the
32MB JSONL output.
AC: a documented env var (`FLOWTRACE_REDACT_KEYS`, comma-separated,
case-insensitive substring match against the arg name; default covers
`password,secret,token,authorization,api_key,url,dsn,connection_string`)
replaces matching argument values with `"<redacted>"` before truncation.
Off-by-default behavior is unchanged when the var is unset apart from the
new default list applying (documented as a behavior change in CHANGELOG).

### AC4 — `flowtrace init` must detect the Python **import** name, not the
### distribution name
`flowtrace-cli/lib/commands/run.js` `detectPythonPrefix()` reads
`[project].name` from `pyproject.toml`, which is the PyPI distribution name
and frequently differs from the importable package (`api-businessrules-over-
validator` on disk, package `over_validator`; canonical stdlib examples:
`pyyaml`→`yaml`, `beautifulsoup4`→`bs4`). A wrong prefix yields `flowtrace run`
exit 0, an output path is printed, and **no file is ever created** — no error.
AC: `detectPythonPrefix()` also checks, in order: (a) `[tool.hatch.build.
targets.wheel].packages` / `[tool.setuptools.packages.find].where`+`include`
entries in `pyproject.toml`, (b) a single top-level directory under `src/`
containing `__init__.py`, (c) a single top-level directory next to
`pyproject.toml` containing `__init__.py`, before falling back to the
distribution-name guess. AND: `flowtrace run` prints a warning and the final
event count to stderr when a Python run under `FLOWTRACE_ENABLE=1` completes
with **zero** emitted events, so a wrong prefix is never silent.

### AC5 — MCP `trace_tree` must not return unbounded payloads
`mcp-server/src/trace-tools.ts` `trace_tree` recursively serializes every
span with no cap. Measured on a real 17.8k-event trace: 5,934-node tree,
1.79MB / ~448k tokens in one response — unusable over MCP, and none of
`trace_tree`, `log_aggregate`, `trace_private_calls` accept a limit (only
`log_search` does, `limit=200` default).
AC: `trace_tree` accepts optional `maxDepth` and `maxNodes` params; when a
subtree is elided the parent node carries `truncated: true` and a count of
elided descendants; total emitted node count is capped at 2000 by default
(overridable) with a top-level `truncated`/`totalNodes` flag on the result.

### AC6 — `trace_diff` must not conflate identically-named methods across
### classes/modules
`mcp-server/src/trace-tools.ts` `trace_diff` groups solely by `` `.method` ``
(the same key format used to render `class.method`, but never joined with
`module`), so two unrelated functions sharing a name in different modules are
averaged together into one meaningless number.
Repro (real trace): `airline_class_master_store._loader` (23.5µs) and
`fare_family_matrix_service._loader` (334.7µs) — 14x apart — both report as
one row `"._loader"` with `avg_a_ns: 179084`.
AC: `duration_deltas` groups by `module + class + method` (matching the key
`trace_private_calls` already uses) and the result row includes `module` and
`class` fields. AND: rows are additionally ranked/filterable by an absolute
duration-delta floor (not `delta_pct` alone), so a 750ns→1542ns entry (+106%)
does not rank above a 1.15ms→0.44ms entry (-61%, the actually significant
one) — add a `min_abs_delta_ns` param (default such that sub-microsecond avg
deltas are excluded from the default view) and sort by absolute delta.

### AC7 — `log_close` must distinguish "already closed" from "never opened"
`mcp-server/src/server.ts` `getSession` raises the same generic
`Invalid sessionId` for both an unknown id and one this process evicted
(despite already tracking an `evicted` Set for the eviction case) — `log_close`
does not add the id to `evicted`, so closing a session and re-querying it is
indistinguishable from a typo.
AC: `log_close` adds the closed id to the `evicted`-equivalent tracking so a
subsequent call against it returns the descriptive
"Session X was evicted/closed..." message, not the generic one.

## Out of scope
- Java/Node/browser capture layers (not exercised in the audit).
- Rewriting `flowtrace analyze`'s dashboard packaging (`repoRoot()` assumes a
  repo checkout; the published tarball omits `flowtrace-dashboard/`) — real
  bug, bigger fix (packaging/build), separate change.
- `init` writing a config that `run` mostly ignores (`packagePrefix`,
  `maxArgLength`, `output.dir`) — real gap, but wiring `run` to read the full
  config is a larger behavior change deserving its own review, not bundled
  here.
- Performance findings in the audited application (api-businessrules-over-
  validator) — reported separately to that repo's owner, not a FlowTrace bug.

## Approach
Fix in place, one test per AC (extending the existing pytest/node test
suites — `capture/python/tests/`, `mcp-server/test/`), run each suite, then
commit. No new dependencies, no restructuring.

## Verification
- `cd capture/python && pip install -e .[dev] && pytest -q`
- `cd mcp-server && npm install && npm test` (or `node --test test/`, matching
  existing convention)
- `cd flowtrace-cli && npm test`
