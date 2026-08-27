# Instrumenting an async generator with any `return` crashes at import

flow: flowtrace-async-gen-return

## Why

Found dogfooding FlowTrace's Python capture against a third, unrelated
real codebase (Astra's `bi-cross-dataagent-api-http-cr`, FastAPI + Google
ADK, Python 3.14) — the first time this capture layer has been exercised
against genuinely different code from what today's earlier fixes were
validated on. Instrumenting `app.features.agent.service` crashed the whole
process at import time:

```
File "app/features/agent/service.py", line 332
    return
    ^^^^^^
SyntaxError: 'return' with value in async generator
```

## Root cause

`capture/python/flowtrace_runtime/transformer.py`'s `_rewrite()` calls
`self._rewrite_returns(node.body, ref)` **unconditionally** for every
function — sync, async, generator or not — before branching on
`is_generator` to pick `_wrap_generator_body` vs `_wrap_normal_body`.

`_ReturnRewriter.visit_Return` turns every `return` statement, bare or not,
into:
```python
_ft_result = <original value, or None if bare>
return _ft_result
```

That is always a `return` **with a value** (a `Name` node), even when the
source had a bare `return`. CPython enforces — at `compile()` time, not
`ast.parse()` time, confirmed by reproducing in isolation — that an `async
def` function containing a `yield` (an async generator) may only contain
bare `return` statements; `return <anything>`, including `return None`
explicitly, is a `SyntaxError`. A *sync* generator has no such restriction
(`return <value>` there legally becomes the `StopIteration.value`) — the bug
is specific to `async def` + `yield`.

Since the only legal form inside an async generator to begin with is a bare
`return`, and the rewriter's output is never legal there regardless of what
the original contained, **every** async generator function with **any**
`return` statement fails to import once instrumented — not just the
early-exit-with-no-value pattern that surfaced it, all of them. Async
generators streaming SSE/chat responses (exactly what triggered this) are a
common, idiomatic pattern in modern async Python services, not an edge case.

## In scope

### AC1 — instrumenting an async generator with a `return` no longer crashes
`_rewrite()` must not apply `_rewrite_returns` to a function that is both
`isinstance(node, ast.AsyncFunctionDef)` and `is_generator` (already computed
via the existing `_has_yield(node)` call). For that case only, leave
`return` statements exactly as written — the only form CPython accepts
there is a bare `return`, so there is nothing valid to rewrite into a
result-capturing form; forcing a capture would either recreate this bug or
require code CPython rejects outright.

Every other case must keep working exactly as before: sync functions, async
non-generator functions (`test_async_function_traced`'s existing case), and
**sync** generators (which legally return a value and whose `_ReturnRewriter`
output stays legal) must still have their returns rewritten as they do
today — do not widen the skip beyond async generators specifically.

AC: a new test compiles+execs a source string shaped like the real trigger
(`async def f(): yield 1; return` — bare return before/after a yield, plus a
second variant with the early-exit-inside-a-branch shape from the real
file) via the existing `_compile_and_exec` harness in
`capture/python/tests/test_transformer.py` — must compile and run without
`SyntaxError`, and must still emit `enter`/`exit` events on iteration (the
existing generator-tracing behavior, `test_generator_enter_exit`'s pattern,
applied to the async case). A second test confirms sync generators with a
`return <value>` are *unaffected* — their `_ft_result` still equals the
returned value on `StopIteration.value` (regression guard for the "every
other case must keep working" requirement above).

## Out of scope

- Anything about what an async generator's "return value" should be
  captured as for tracing purposes (there isn't one to capture — `return`
  there only signals "generator exhausted early", nothing more, same as
  Python's own `StopAsyncIteration` carries no value). No new capture
  semantics for this case, just: don't crash.
- The Next.js `NODE_OPTIONS` propagation gap found in the same dogfooding
  session — different layer (Node capture, not Python), different fix
  shape, not bundled here.
- Any other codepath in `service.py` or Astra's repos — this fix lives
  entirely in `flowtrace-debugger`, not in the codebase that surfaced it.

## Approach
One-line-ish guard at the `_rewrite()` call site (already have `is_generator`
computed; add the `AsyncFunctionDef` check and skip the rewrite call). Two
new tests in the existing `capture/python/tests/test_transformer.py`,
following its established `_compile_and_exec` pattern. No new dependencies.

## Verification
- `cd capture/python && pytest -q` (full suite — regression coverage on
  every existing generator/async test)
- Manual: re-trace the same real trigger shape as a standalone repro (not
  Astra's actual code, which isn't part of this repo) to confirm the fix
  holds outside the unit-test harness too
