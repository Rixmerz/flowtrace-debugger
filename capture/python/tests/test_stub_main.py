"""Behaviour of the sitecustomize stub when tracing a main script.

The stub transforms the main module and then calls ``os._exit`` to stop the
interpreter re-running the original file. ``os._exit`` skips interpreter
shutdown, which is where Python flushes ``sys.stdout``/``sys.stderr`` — so
everything here is about the traced program remaining observationally identical
to an untraced run.

Regression coverage for two defects:

- stdout was block-buffered (any non-TTY) and never flushed, so a traced program
  produced **no output at all** while still emitting a full trace.
- an uncaught exception in the traced program fell through to the stub's generic
  handler, which printed a misleading "could not install hook" warning and then
  let the interpreter execute the script a *second* time, repeating its side
  effects. Tracing a program that crashes is the main use case for a debugger.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[3]
STUB_DIR = REPO_ROOT / "capture" / "python" / "stub"
CAPTURE_PKG = REPO_ROOT / "capture" / "python"


def _run(script: Path, out_path: Path, prefix: str) -> subprocess.CompletedProcess:
    """Run `script` under FlowTrace with stdout captured (i.e. a pipe, not a TTY)."""
    pythonpath = os.pathsep.join(
        [str(STUB_DIR), str(CAPTURE_PKG), os.environ.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    env = {
        **os.environ,
        "PYTHONPATH": pythonpath,
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": prefix,
        "FLOWTRACE_OUTPUT": str(out_path),
    }
    env.pop("FLOWTRACE_TRACEPARENT", None)
    return subprocess.run(
        [sys.executable, script.name],
        cwd=str(script.parent),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _write(tmp_path: Path, name: str, body: str) -> Path:
    path = tmp_path / name
    path.write_text(textwrap.dedent(body), encoding="utf-8")
    return path


def test_traced_program_keeps_its_stdout(tmp_path):
    script = _write(tmp_path, "printer.py", """
        def greet(name):
            return "hello " + name

        print(greet("world"))
        print("second line")
    """)
    out = tmp_path / "trace.jsonl"

    result = _run(script, out, "printer")

    assert result.returncode == 0, result.stderr
    # The whole point: stdout survives os._exit.
    assert "hello world" in result.stdout
    assert "second line" in result.stdout
    # ...and the program really was traced, so this is not passing by accident
    # because instrumentation silently did nothing.
    assert out.exists() and out.read_text(encoding="utf-8").strip(), "no events emitted"


def test_traced_program_preserves_a_nonzero_exit_code(tmp_path):
    script = _write(tmp_path, "exiting.py", """
        import sys

        def leave():
            print("leaving")
            sys.exit(3)

        leave()
    """)
    out = tmp_path / "trace.jsonl"

    result = _run(script, out, "exiting")

    assert result.returncode == 3, f"expected 3, got {result.returncode}: {result.stderr}"
    assert "leaving" in result.stdout


def test_traced_program_exits_zero_on_success(tmp_path):
    script = _write(tmp_path, "ok.py", """
        def work():
            return 1

        work()
    """)
    out = tmp_path / "trace.jsonl"
    assert _run(script, out, "ok").returncode == 0


def test_uncaught_exception_behaves_like_an_untraced_run(tmp_path):
    script = _write(tmp_path, "failing.py", """
        def boom():
            raise ValueError("kaboom")

        print("side effect")
        boom()
    """)
    out = tmp_path / "trace.jsonl"

    result = _run(script, out, "failing")

    assert result.returncode == 1, f"expected 1, got {result.returncode}"
    # The real exception must be reported...
    assert "ValueError" in result.stderr
    assert "kaboom" in result.stderr
    # ...and NOT dressed up as a FlowTrace installation problem.
    assert "could not install hook" not in result.stderr

    # The side effect must happen exactly once. Falling through to the generic
    # handler used to let the interpreter run the whole script again.
    assert result.stdout.count("side effect") == 1, (
        f"script body ran {result.stdout.count('side effect')} times:\n{result.stdout}"
    )


def test_a_crashing_program_still_produces_a_trace(tmp_path):
    # The events leading up to a crash are the most valuable ones a debugger can
    # give you, so they must survive the failure path.
    script = _write(tmp_path, "crashing.py", """
        def step_one():
            return 1

        def step_two():
            raise RuntimeError("late failure")

        step_one()
        step_two()
    """)
    out = tmp_path / "trace.jsonl"

    _run(script, out, "crashing")

    assert out.exists(), "no trace file written for a crashing program"
    events = [line for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert events, "crashing program produced an empty trace"
    methods = {__import__("json").loads(line)["method"] for line in events}
    assert "step_one" in methods
    assert "step_two" in methods
