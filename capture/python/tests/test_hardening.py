"""Guarantees the capture layer makes to the program it instruments:
it never raises into it, never changes what it does, and reports its own
failures once.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest

from flowtrace_runtime import bootstrap, runtime
from flowtrace_runtime.context import current_span_id, current_trace_id, enter_span, exit_span
from flowtrace_runtime.emitter import Emitter
from flowtrace_runtime.transformer import FlowtraceTransformer

REPO = Path(__file__).resolve().parents[3]
PY_PKG = REPO / "capture" / "python"
PY_STUB = PY_PKG / "stub"


def _valid_event(**overrides):
    ev = {
        "ts": 1.0, "trace_id": "a" * 32, "span_id": "b" * 16, "parent_id": None,
        "event": "enter", "thread": "main", "lang": "python", "module": "m",
        "class": "", "method": "f", "visibility": "public", "args": {}, "depth": 0,
    }
    ev.update(overrides)
    return ev


# ----------------------------------------------------------------------
# emitter
# ----------------------------------------------------------------------

def test_emit_never_raises_when_output_is_a_directory(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path))  # a directory, not a file
    em = Emitter()
    em.emit(_valid_event())
    em.emit(_valid_event())
    assert em.dropped_count() == 2
    err = capsys.readouterr().err
    assert err.count("failed to write event") == 1, "warned once, counted twice"


def test_emit_survives_unserializable_values(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "t.jsonl"))
    em = Emitter()
    em.emit(_valid_event(args={"x": object()}))
    assert em.dropped_count() == 1
    assert "cannot be serialized" in capsys.readouterr().err


@pytest.mark.skipif(not hasattr(os, "fork"), reason="fork-only")
def test_forked_child_writes_to_the_same_file_without_sharing_state(tmp_path, monkeypatch):
    out = tmp_path / "t.jsonl"
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(out))
    em = Emitter()
    em.emit(_valid_event(method="parent"))
    pid = os.fork()
    if pid == 0:  # child
        try:
            em.emit(_valid_event(method="child"))
        finally:
            os._exit(0)
    _, status = os.waitpid(pid, 0)
    assert status == 0
    em.emit(_valid_event(method="parent-after"))
    methods = [json.loads(l)["method"] for l in out.read_text().splitlines()]
    assert sorted(methods) == ["child", "parent", "parent-after"]


def test_default_output_name_is_unique_per_process(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("FLOWTRACE_OUTPUT", raising=False)
    em = Emitter()
    em.emit(_valid_event())
    name = em.path().name
    assert name.endswith(f"-{os.getpid()}.jsonl"), name


# ----------------------------------------------------------------------
# runtime helpers
# ----------------------------------------------------------------------

def _run(func_name, ctx_cls=None):
    pass


def _events(path):
    return [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]


@pytest.fixture
def emitter_file(tmp_path, monkeypatch):
    out = tmp_path / "t.jsonl"
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(out))
    fresh = Emitter()
    monkeypatch.setattr(Emitter, "_instance", fresh)
    runtime.reset_config()
    yield out
    runtime.reset_config()


def test_result_is_always_wrapped_and_truncated(emitter_file, monkeypatch):
    monkeypatch.setenv("FLOWTRACE_MAX_ARG_LENGTH", "32")
    runtime.reset_config()
    ctx = runtime._ft_enter("m", "f", {"data": "x" * 500}, "public")
    runtime._ft_exit(ctx, {"status": "ok"})
    ctx = runtime._ft_enter("m", "g", {}, "public")
    runtime._ft_exit(ctx, "y" * 500)
    ctx = runtime._ft_enter("m", "h", {}, "public")
    runtime._ft_exit(ctx, None)
    exits = [e for e in _events(emitter_file) if e["event"] == "exit"]
    assert exits[0]["result"] == {"value": {"status": "ok"}}, "a dict return is wrapped like any other"
    assert exits[1]["result"]["value"].startswith('<truncated:"yyy')
    assert exits[1]["result"]["value"].endswith("...>")
    assert exits[2]["result"] == {}
    enters = [e for e in _events(emitter_file) if e["event"] == "enter"]
    assert enters[0]["args"]["data"].startswith('<truncated:"xxx')


def test_helpers_never_raise_into_the_program(emitter_file, monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("emitter is broken")

    monkeypatch.setattr(Emitter.instance(), "emit", boom)
    ctx = runtime._ft_enter("m", "f", {"a": 1}, "public")
    runtime._ft_exit(ctx, 1)          # must not raise
    runtime._ft_exit_error(ctx, ValueError("x"))
    err = capsys.readouterr().err
    assert "instrumentation failed" in err
    assert err.count("instrumentation failed") == 1, "reported once"
    # the context is unwound even though emit failed
    assert current_span_id.get() == ""


def test_exit_span_tolerates_a_token_from_another_context():
    import contextvars
    tokens = enter_span("a" * 32, "b" * 16)
    # reset() in a different Context raises ValueError in CPython
    contextvars.copy_context().run(exit_span, tokens)
    exit_span(tokens)  # the proper one still works
    assert current_span_id.get() == ""


def test_nan_and_infinity_do_not_produce_invalid_json():
    safe = runtime._to_json_safe({"a": float("nan"), "b": float("inf"), "c": 1.5})
    json.loads(json.dumps(safe))
    assert safe["c"] == 1.5 and safe["a"] == "nan" and safe["b"] == "inf"


# ----------------------------------------------------------------------
# transformer: docstrings
# ----------------------------------------------------------------------

def _instrument_and_exec(src):
    tree = FlowtraceTransformer(module_name="m").visit(ast.parse(textwrap.dedent(src)))
    ast.fix_missing_locations(tree)
    ns = {
        "_ft_enter": lambda *a: {"dead": True},
        "_ft_exit": lambda *a: None,
        "_ft_exit_error": lambda *a: None,
    }
    exec(compile(tree, "<m>", "exec"), ns)
    return ns


def test_docstrings_survive_instrumentation():
    ns = _instrument_and_exec('''
        def greet(name):
            """Say hello to NAME."""
            return "hi " + name

        async def agreet(name):
            """Async hello."""
            return name

        def gen():
            """A generator."""
            yield 1

        class C:
            def m(self):
                """Method doc."""
                return 1

        def only_doc():
            """Nothing but a docstring."""
    ''')
    assert ns["greet"].__doc__ == "Say hello to NAME."
    assert ns["greet"]("x") == "hi x"
    assert ns["agreet"].__doc__ == "Async hello."
    assert ns["gen"].__doc__ == "A generator."
    assert list(ns["gen"]()) == [1]
    assert ns["C"].m.__doc__ == "Method doc."
    assert ns["C"]().m() == 1
    assert ns["only_doc"].__doc__ == "Nothing but a docstring."
    assert ns["only_doc"]() is None


# ----------------------------------------------------------------------
# threads
# ----------------------------------------------------------------------

def test_threads_inherit_the_starting_span():
    bootstrap._install_thread_propagation()
    seen = {}

    def worker():
        seen["trace"] = current_trace_id.get()
        seen["span"] = current_span_id.get()

    class Sub(threading.Thread):
        def run(self):
            seen["sub_trace"] = current_trace_id.get()

    tokens = enter_span("c" * 32, "d" * 16)
    try:
        t = threading.Thread(target=worker)
        t.start(); t.join()
        s = Sub()
        s.start(); s.join()
    finally:
        exit_span(tokens)
    assert seen["trace"] == "c" * 32
    assert seen["span"] == "d" * 16
    assert seen["sub_trace"] == "c" * 32, "subclasses overriding run() are covered"


def test_thread_patch_is_idempotent():
    bootstrap._install_thread_propagation()
    first = threading.Thread.start
    bootstrap._install_thread_propagation()
    assert threading.Thread.start is first


# ----------------------------------------------------------------------
# sitecustomize: the main script
# ----------------------------------------------------------------------

def _run_script(tmp_path, body, prefix, relpath="app.py"):
    script = tmp_path / relpath
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(textwrap.dedent(body))
    out = tmp_path / "trace.jsonl"
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(PY_STUB), str(PY_PKG)]),
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": prefix,
        "FLOWTRACE_OUTPUT": str(out),
    }
    res = subprocess.run([sys.executable, str(script)], cwd=tmp_path, env=env,
                         capture_output=True, text=True, timeout=60)
    events = _events(out) if out.exists() else []
    return res, events


def test_main_script_exit_code_and_atexit_are_preserved(tmp_path):
    res, events = _run_script(tmp_path, '''
        import atexit, sys
        atexit.register(lambda: print("ATEXIT RAN"))
        def work(): return 1
        work()
        print("body done")
        sys.exit(3)
    ''', "app")
    assert res.returncode == 3, res.stderr
    assert "body done" in res.stdout
    assert "ATEXIT RAN" in res.stdout
    assert [e["method"] for e in events] == ["work", "work"]


def test_main_script_uncaught_exception_exits_1_with_traceback(tmp_path):
    res, _ = _run_script(tmp_path, '''
        def work(): raise ValueError("kaboom")
        work()
    ''', "app")
    assert res.returncode == 1
    assert "ValueError: kaboom" in res.stderr


def test_main_script_normal_end_exits_0_and_joins_threads(tmp_path):
    res, events = _run_script(tmp_path, '''
        import threading, time
        def late(): time.sleep(0.2); print("thread finished")
        threading.Thread(target=late).start()
        def work(): return 1
        work()
    ''', "app")
    assert res.returncode == 0, res.stderr
    assert "thread finished" in res.stdout, "non-daemon threads are joined before exit"


def test_main_script_under_a_package_directory_is_instrumented(tmp_path):
    res, events = _run_script(tmp_path, '''
        def entry(): return "ok"
        entry()
    ''', "myapp", relpath="src/myapp/main.py")
    assert res.returncode == 0, res.stderr
    assert [e["method"] for e in events] == ["entry", "entry"], \
        "main.py inside the myapp package is traced even though its basename is not the prefix"


# ----------------------------------------------------------------------
# cache permissions
# ----------------------------------------------------------------------

def test_bytecode_cache_is_private(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    from flowtrace_runtime import loader
    p = loader._cache_path(b"x = 1\n", "/tmp/x.py")
    cache_dir = p.parent
    assert oct(cache_dir.stat().st_mode & 0o777) == "0o700"
    loader._write_private(p, b"data")
    assert oct(p.stat().st_mode & 0o777) == "0o600"
