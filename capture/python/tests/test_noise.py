"""Spans the program did not cause: serializer re-entrancy and generator frames.

Each test runs a tiny package under the real import hook in a subprocess and
reads the JSONL back, the same way the repros in the bug report were produced.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).parents[3]
STUB_DIR = REPO_ROOT / "capture" / "python" / "stub"
CAPTURE_PKG = REPO_ROOT / "capture" / "python"


def run_pkg(tmp_path: Path, source: str, entry: str = "main()", extra_env: dict | None = None) -> list[dict]:
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "m.py").write_text(textwrap.dedent(source))
    (tmp_path / "run.py").write_text(f"from pkg import m\nm.{entry}\n")
    out = tmp_path / "t.jsonl"
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(STUB_DIR), str(CAPTURE_PKG), str(tmp_path)]),
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": "pkg",
        "FLOWTRACE_OUTPUT": str(out),
        **(extra_env or {}),
    }
    r = subprocess.run([sys.executable, str(tmp_path / "run.py")], env=env,
                       capture_output=True, text=True, timeout=60, cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    return [json.loads(line) for line in out.read_text().splitlines()]


def enters(events):
    return {e["method"]: e for e in events if e["event"] == "enter"}


def check_pairing(events):
    opened = {e["span_id"] for e in events if e["event"] == "enter"}
    closed = [e["span_id"] for e in events if e["event"] == "exit"]
    assert len(closed) == len(set(closed))
    assert set(closed) <= opened


# ---------------------------------------------------------------- finding 1

SERIALIZER = """
class P:
    def __repr__(self):
        return "P()"

class Boom(Exception):
    def __str__(self):
        return "boom-text"

class R:
    def __repr__(self):
        return "R()"

def takes(p):
    return R()

def raises(p):
    raise Boom()

def user_repr():
    return repr(P())

def main():
    takes(P())
    try:
        raises(P())
    except Boom:
        pass
    user_repr()
"""


def test_repr_called_by_serializer_emits_no_span(tmp_path):
    events = run_pkg(tmp_path, SERIALIZER)
    reprs = [e for e in events if e["event"] == "enter" and e["method"] == "__repr__"]
    # Only the one the program itself called (user_repr) is traced.
    assert [r["class"] for r in reprs] == ["P"]
    by_span = {e["span_id"]: e for e in events if e["event"] == "enter"}
    assert by_span[reprs[0]["parent_id"]]["method"] == "user_repr"
    assert [e["method"] for e in events if e["event"] == "enter" and e["method"] in ("__str__",)] == []
    check_pairing(events)


def test_repr_text_still_in_args_and_result(tmp_path):
    events = run_pkg(tmp_path, SERIALIZER)
    takes_in = next(e for e in events if e["event"] == "enter" and e["method"] == "takes")
    assert takes_in["args"] == {"p": "P()"}
    takes_out = next(e for e in events if e["event"] == "exit" and e["method"] == "takes")
    assert takes_out["result"] == {"value": "R()"}
    err = next(e for e in events if e["event"] == "exit" and e["method"] == "raises")
    assert err["error"]["msg"] == "boom-text"


def test_calls_made_by_a_repr_are_suppressed_and_context_untouched(tmp_path):
    events = run_pkg(tmp_path, """
        def helper():
            return 1
        class Q:
            def __repr__(self):
                helper()
                return "Q()"
        def takes(q):
            helper()
        def main():
            takes(Q())
        """)
    methods = [e["method"] for e in events if e["event"] == "enter"]
    assert methods == ["main", "takes", "helper"]
    by = enters(events)
    assert by["helper"]["parent_id"] == by["takes"]["span_id"]
    assert by["takes"]["parent_id"] == by["main"]["span_id"]
    check_pairing(events)


def test_guard_is_per_context_not_global(tmp_path):
    # A thread running while another thread's repr executes must still be traced.
    events = run_pkg(tmp_path, """
        import threading
        gate = threading.Event(); done = threading.Event()
        def work():
            return 1
        class Slow:
            def __repr__(self):
                gate.set(); done.wait(5)
                return "Slow()"
        def worker():
            gate.wait(5)
            work()
            done.set()
        def takes(s):
            return None
        def main():
            t = threading.Thread(target=worker); t.start()
            takes(Slow())
            t.join()
        """)
    assert "work" in enters(events)


# ---------------------------------------------------------------- finding 2

def test_contextmanager_body_attributes_to_caller(tmp_path):
    events = run_pkg(tmp_path, """
        import contextlib
        @contextlib.contextmanager
        def ctx():
            yield
        def work():
            return 2
        def caller():
            with ctx():
                work()
        def main():
            caller()
        """)
    by = enters(events)
    assert by["work"]["parent_id"] == by["caller"]["span_id"]
    assert by["ctx"]["parent_id"] == by["caller"]["span_id"]
    check_pairing(events)


def test_code_between_next_calls_attributes_to_consumer(tmp_path):
    events = run_pkg(tmp_path, """
        def gen():
            yield 1
            yield 2
        def start():
            g = gen()
            next(g)
            return g
        def after():
            return 3
        def main():
            g = start()
            after()
            list(g)
        """)
    by = enters(events)
    assert by["after"]["parent_id"] == by["main"]["span_id"]
    check_pairing(events)
    # The generator span still opens once and closes once, after exhaustion.
    gen_exit = next(e for e in events if e["event"] == "exit" and e["method"] == "gen")
    assert gen_exit["duration_ns"] > 0


def test_calls_inside_generator_body_attribute_to_generator(tmp_path):
    events = run_pkg(tmp_path, """
        def inner(x):
            return x
        def gen():
            a = inner(1)
            got = yield a
            inner(got)
            yield inner(3)
        def main():
            g = gen()
            next(g)
            g.send(10)
            list(g)
        """)
    ev = [e for e in events if e["event"] == "enter"]
    g = next(e for e in ev if e["method"] == "gen")
    inners = [e for e in ev if e["method"] == "inner"]
    assert len(inners) == 3
    assert all(i["parent_id"] == g["span_id"] for i in inners)
    check_pairing(events)


def test_generator_exception_and_close_pair_correctly(tmp_path):
    events = run_pkg(tmp_path, """
        def cleanup():
            return 0
        def gen():
            try:
                yield 1
                yield 2
            finally:
                cleanup()
        def after():
            return 1
        def main():
            g = gen()
            next(g)
            g.close()
            after()
        """)
    by = enters(events)
    assert by["cleanup"]["parent_id"] == by["gen"]["span_id"]
    assert by["after"]["parent_id"] == by["main"]["span_id"]
    check_pairing(events)
    assert len([e for e in events if e["event"] == "exit"]) == len(
        [e for e in events if e["event"] == "enter"])


def test_yield_inside_expression_and_yield_from(tmp_path):
    events = run_pkg(tmp_path, """
        def after():
            return 1
        def sub():
            yield 1
        def gen():
            x = (yield 1) or 0
            yield from sub()
        def main():
            g = gen()
            next(g)
            after()
            g.send(5)
            after()
            list(g)
        """)
    afters = [e for e in events if e["event"] == "enter" and e["method"] == "after"]
    m = enters(events)["main"]
    assert [a["parent_id"] for a in afters] == [m["span_id"]] * 2
    check_pairing(events)


def test_async_generator_does_not_leak_span(tmp_path):
    events = run_pkg(tmp_path, """
        import asyncio
        def after():
            return 1
        async def agen():
            yield 1
            yield 2
        async def amain():
            async for _ in agen():
                after()
        def main():
            asyncio.run(amain())
        """)
    by = enters(events)
    assert by["after"]["parent_id"] == by["amain"]["span_id"]
    check_pairing(events)


def test_throw_caught_inside_generator_runs_in_generator_span(tmp_path):
    events = run_pkg(tmp_path, """
        def handled():
            return 0
        def gen():
            while True:
                try:
                    yield 1
                except ValueError:
                    handled()
                    yield 2
        def main():
            g = gen()
            next(g)
            g.throw(ValueError())
            g.close()
        """)
    by = enters(events)
    assert by["handled"]["parent_id"] == by["gen"]["span_id"]
    check_pairing(events)


def test_error_in_generator_after_yield_is_paired(tmp_path):
    events = run_pkg(tmp_path, """
        def gen():
            yield 1
            raise RuntimeError("late")
        def after():
            return 1
        def main():
            g = gen()
            next(g)
            try:
                next(g)
            except RuntimeError:
                pass
            after()
        """)
    by = enters(events)
    assert by["after"]["parent_id"] == by["main"]["span_id"]
    err = [e for e in events if e["event"] == "exit" and e["method"] == "gen"]
    assert len(err) == 1 and err[0]["error"]["type"] == "RuntimeError"
    check_pairing(events)


# ------------------------------------------- repr() of a user object runs

# Django's BaseFormSet.__repr__ reads a lazily computed property whose first
# evaluation validates a form. An instrumented ``cached_property.__get__``
# receives the formset as ``instance``, so serialising that argument evaluated
# the property early and made a test counting ``full_clean`` calls see one more
# call than untraced. The ``repr`` call is the documented format for non-
# primitive values, so this is a known caveat, not a defect; the escape hatch
# is FLOWTRACE_REDACT_KEYS. These tests pin both halves of that statement.
REPR_SIDE_EFFECT = """
CALLS = []

class Lazy:
    def __repr__(self):
        CALLS.append("repr")
        return "Lazy()"

def use(instance):
    return 1

def main():
    use(Lazy())
    assert CALLS == [], CALLS
"""


def test_repr_of_user_object_runs_and_is_known_caveat(tmp_path):
    # Traced: repr ran once (the assertion in main() fails); no span for it.
    try:
        run_pkg(tmp_path, REPR_SIDE_EFFECT)
    except AssertionError as exc:
        assert "AssertionError" in str(exc)
    else:
        raise AssertionError("expected the program to observe the repr() call")


def test_redact_keys_keeps_repr_from_running(tmp_path):
    events = run_pkg(tmp_path, REPR_SIDE_EFFECT, extra_env={"FLOWTRACE_REDACT_KEYS": "instance"})
    assert enters(events)["use"]["args"] == {"instance": "<redacted>"}
