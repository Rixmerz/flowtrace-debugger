"""Tests for FlowtraceTransformer — AST rewrite correctness."""

from __future__ import annotations

import ast
import asyncio
import sys
import textwrap
import types
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from flowtrace_runtime.transformer import FlowtraceTransformer, _visibility


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compile_and_exec(source: str, module_name: str = "test_mod") -> tuple[types.ModuleType, list[dict]]:
    """Transform + compile + exec source in a sandbox module. Returns (module, emitted_events)."""
    emitted: list[dict] = []

    def fake_enter(module, qualname, locals_dict, visibility):
        ctx = {
            "start_ns": 0,
            "span_id": "aabbccdd11223344",
            "trace_id": "a" * 32,
            "parent_id": None,
            "module": module,
            "qualname": qualname,
            "class": qualname.rsplit(".", 1)[0] if "." in qualname else "",
            "method": qualname.rsplit(".", 1)[1] if "." in qualname else qualname,
            "visibility": visibility,
            "depth": 0,
            "args": {k: v for k, v in locals_dict.items() if k not in ("self", "cls")},
            "tokens": None,
        }
        emitted.append({"event": "enter", "qualname": qualname, "visibility": visibility,
                        "args": ctx["args"]})
        return ctx

    def fake_exit(ctx, result):
        emitted.append({"event": "exit", "qualname": ctx["qualname"], "result": result})

    def fake_exit_error(ctx, exc):
        emitted.append({"event": "exit_error", "qualname": ctx["qualname"], "exc": exc})

    tree = ast.parse(textwrap.dedent(source))
    transformer = FlowtraceTransformer(module_name=module_name)
    transformed = transformer.visit(tree)
    ast.fix_missing_locations(transformed)
    code = compile(transformed, "<test>", "exec", dont_inherit=True)

    mod = types.ModuleType(module_name)
    mod.__dict__["_ft_enter"] = fake_enter
    mod.__dict__["_ft_exit"] = fake_exit
    mod.__dict__["_ft_exit_error"] = fake_exit_error
    exec(code, mod.__dict__)  # noqa: S102
    return mod, emitted


# ---------------------------------------------------------------------------
# Visibility mapping
# ---------------------------------------------------------------------------

def test_visibility_public():
    assert _visibility("add") == "public"
    assert _visibility("run") == "public"


def test_visibility_private():
    assert _visibility("_validate") == "private"
    assert _visibility("_helper") == "private"


def test_visibility_internal():
    assert _visibility("__init__") == "internal"
    assert _visibility("__repr__") == "internal"
    assert _visibility("__dunder__") == "internal"


# ---------------------------------------------------------------------------
# Basic call tracing
# ---------------------------------------------------------------------------

def test_simple_function_traced():
    src = """
    def add(a, b):
        return a + b
    """
    mod, events = _compile_and_exec(src)
    result = mod.add(2, 3)
    assert result == 5
    assert len(events) == 2
    assert events[0]["event"] == "enter"
    assert events[0]["qualname"] == "add"
    assert events[1]["event"] == "exit"
    assert events[1]["result"] == 5


def test_method_in_class_traced():
    src = """
    class Calculator:
        def run(self):
            return 42
    """
    mod, events = _compile_and_exec(src)
    calc = mod.Calculator()
    result = calc.run()
    assert result == 42
    assert events[0]["qualname"] == "Calculator.run"
    assert events[0]["visibility"] == "public"


def test_private_method_visibility():
    src = """
    class Foo:
        def _helper(self, x):
            return x * 2
    """
    mod, events = _compile_and_exec(src)
    f = mod.Foo()
    f._helper(5)
    assert events[0]["visibility"] == "private"
    assert events[0]["qualname"] == "Foo._helper"


def test_dunder_method_visibility():
    src = """
    class Foo:
        def __init__(self):
            self.x = 1
    """
    mod, events = _compile_and_exec(src)
    mod.Foo()
    assert events[0]["visibility"] == "internal"


def test_nested_calls_traced():
    src = """
    class Calc:
        def run(self):
            return self.add(2, 3)

        def add(self, a, b):
            return a + b
    """
    mod, events = _compile_and_exec(src)
    c = mod.Calc()
    c.run()
    qualnames = [e["qualname"] for e in events]
    assert qualnames == ["Calc.run", "Calc.add", "Calc.add", "Calc.run"]
    assert events[0]["event"] == "enter"
    assert events[-1]["event"] == "exit"


# ---------------------------------------------------------------------------
# Exception handling
# ---------------------------------------------------------------------------

def test_exception_emits_exit_error():
    src = """
    def boom():
        raise ValueError("oops")
    """
    mod, events = _compile_and_exec(src)
    with pytest.raises(ValueError):
        mod.boom()
    assert events[-1]["event"] == "exit_error"
    assert isinstance(events[-1]["exc"], ValueError)


# ---------------------------------------------------------------------------
# Generator support
# ---------------------------------------------------------------------------

def test_generator_enter_exit():
    src = """
    def gen():
        yield 1
        yield 2
    """
    mod, events = _compile_and_exec(src)
    g = mod.gen()
    enter_events = [e for e in events if e["event"] == "enter"]
    # Enter happens on first call to gen() — before first next().
    # Actually enter is at function body start which runs on first next().
    vals = list(g)
    assert vals == [1, 2]
    enters = [e for e in events if e["event"] == "enter"]
    assert len(enters) == 1


def test_generator_exit_on_close():
    src = """
    def gen():
        yield 1
        yield 2
    """
    mod, events = _compile_and_exec(src)
    g = mod.gen()
    next(g)
    g.close()
    # GeneratorExit is a normal lifecycle termination; must produce a normal exit event.
    exit_events = [e for e in events if e["event"] == "exit"]
    assert len(exit_events) >= 1
    error_events = [e for e in events if e["event"] == "exit_error"]
    assert len(error_events) == 0


# ---------------------------------------------------------------------------
# Async function support
# ---------------------------------------------------------------------------

def test_async_function_traced():
    src = """
    async def fetch(url):
        return f"data:{url}"
    """
    mod, events = _compile_and_exec(src)
    result = asyncio.run(mod.fetch("http://example.com"))
    assert result == "data:http://example.com"
    assert events[0]["event"] == "enter"
    assert events[-1]["event"] == "exit"


def test_async_generator_with_bare_return_traced():
    src = """
    async def agen():
        yield 1
        return
    """
    mod, events = _compile_and_exec(src)

    async def consume():
        return [x async for x in mod.agen()]

    vals = asyncio.run(consume())
    assert vals == [1]
    enters = [e for e in events if e["event"] == "enter"]
    exits = [e for e in events if e["event"] == "exit"]
    assert len(enters) == 1
    assert len(exits) >= 1


def test_async_generator_early_return_in_try_except_traced():
    src = """
    async def agen(fail):
        try:
            if fail:
                return
        except Exception:
            return
        yield 1
    """
    mod, events = _compile_and_exec(src)

    async def consume():
        return [x async for x in mod.agen(False)]

    vals = asyncio.run(consume())
    assert vals == [1]
    enters = [e for e in events if e["event"] == "enter"]
    exits = [e for e in events if e["event"] == "exit"]
    assert len(enters) == 1
    assert len(exits) >= 1


def test_outer_async_function_with_nested_async_generator_returns_real_value():
    """Regression: a yield inside a NESTED async generator must not make the
    OUTER (non-generator) async function misclassify as is_generator=True.
    Before the manual-recursion fix, ast.walk() would surface the nested
    inner()'s Yield node to the outer _has_yield check regardless of the
    FunctionDef skip, causing the outer's real return value to be dropped
    (lap-1's async-generator guard would incorrectly skip return rewriting
    for outer, leaving _ft_result as its default None)."""
    src = """
    async def outer():
        async def inner():
            yield 1
            yield 2
        total = 0
        async for x in inner():
            total += x
        return total
    """
    mod, events = _compile_and_exec(src)
    result = asyncio.run(mod.outer())
    assert result == 3
    exits = [e for e in events if e["event"] == "exit" and e["qualname"] == "outer"]
    assert len(exits) == 1
    assert exits[0]["result"] == 3


def test_sync_generator_return_value_unaffected():
    src = """
    def gen():
        yield 1
        return 5
    """
    mod, events = _compile_and_exec(src)
    g = mod.gen()
    assert next(g) == 1
    with pytest.raises(StopIteration) as exc_info:
        next(g)
    assert exc_info.value.value == 5


# ---------------------------------------------------------------------------
# Decorator preservation
# ---------------------------------------------------------------------------

def test_functools_wraps_preserved():
    src = """
    import functools

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper

    @decorator
    def my_func(x):
        return x + 1
    """
    mod, events = _compile_and_exec(src)
    assert mod.my_func.__name__ == "my_func"
    result = mod.my_func(5)
    assert result == 6
