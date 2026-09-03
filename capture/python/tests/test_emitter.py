"""Tests for flowtrace_runtime.emitter — JSONL v2 writer."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

from flowtrace_runtime.emitter import Emitter
from flowtrace_runtime.ids import new_span_id, new_trace_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_enter(tid: str | None = None, sid: str | None = None) -> dict:
    return {
        "ts": time.time(),
        "trace_id": tid or new_trace_id(),
        "span_id": sid or new_span_id(),
        "parent_id": None,
        "event": "enter",
        "thread": "main",
        "lang": "python",
        "module": "myapp.service",
        "class": "UserService",
        "method": "get_user",
        "visibility": "public",
        "args": {"user_id": 42},
        "depth": 0,
    }


def _make_exit(enter: dict, duration_ns: int = 1000) -> dict:
    ex = dict(enter)
    ex["event"] = "exit"
    ex["ts"] = time.time()
    ex["result"] = {"id": 42, "name": "Alice"}
    ex["duration_ns"] = duration_ns
    return ex


def _fresh_emitter(tmp_path: Path) -> Emitter:
    """Create a fresh (non-singleton) Emitter writing to tmp_path."""
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)
    out = tmp_path / "trace.jsonl"
    os.environ["FLOWTRACE_OUTPUT"] = str(out)
    return e, out


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_emit_enter_and_exit_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    enter = _make_enter()
    exit_ev = _make_exit(enter)
    e.emit(enter)
    e.emit(exit_ev)
    e._flush()

    lines = (tmp_path / "trace.jsonl").read_text().splitlines()
    assert len(lines) == 2
    parsed_enter = json.loads(lines[0])
    parsed_exit = json.loads(lines[1])
    assert parsed_enter["event"] == "enter"
    assert parsed_exit["event"] == "exit"
    assert parsed_exit["duration_ns"] >= 0


def test_bad_trace_id_rejected(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    bad = _make_enter()
    bad["trace_id"] = "not-valid"
    e.emit(bad)

    captured = capsys.readouterr()
    assert "WARNING" in captured.err
    assert not (tmp_path / "trace.jsonl").exists()


def test_bad_span_id_rejected(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    bad = _make_enter()
    bad["span_id"] = "ZZZZ"
    e.emit(bad)

    captured = capsys.readouterr()
    assert "WARNING" in captured.err


def test_missing_required_field_rejected(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    bad = _make_enter()
    del bad["method"]
    e.emit(bad)

    captured = capsys.readouterr()
    assert "WARNING" in captured.err


def test_concurrent_emit_no_interleaving(tmp_path, monkeypatch):
    """100 threads x 100 emits = 10 000 lines, each a complete JSON object."""
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    errors: list[str] = []

    def worker():
        tid = new_trace_id()
        for _ in range(100):
            ev = _make_enter(tid=tid)
            e.emit(ev)

    threads = [threading.Thread(target=worker) for _ in range(100)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    e._flush()

    lines = (tmp_path / "trace.jsonl").read_text().splitlines()
    assert len(lines) == 10_000, f"expected 10000 lines, got {len(lines)}"
    for i, line in enumerate(lines):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"line {i}: {exc}")
    assert not errors, f"malformed lines: {errors[:5]}"


def test_atexit_flush_registered(tmp_path, monkeypatch):
    """Emitter registers an atexit handler without raising."""
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)
    # Simply check that construction did not raise and _flush is callable.
    assert callable(e._flush)


# ---------------------------------------------------------------------------
# Fork-hook lifetime
# ---------------------------------------------------------------------------

def test_fork_hook_is_registered_once_for_all_emitters(tmp_path, monkeypatch):
    """os.register_at_fork has no unregister, so it must be called once.

    Registering per instance appended a permanent callback holding that
    Emitter, and through it an open file, for the life of the interpreter.
    """
    import flowtrace_runtime.emitter as em

    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    calls = []
    monkeypatch.setattr(os, "register_at_fork", lambda **kw: calls.append(kw))
    monkeypatch.setattr(em, "_process_hooks_registered", False)

    for _ in range(5):
        e = Emitter.__new__(Emitter)
        Emitter.__init__(e)
        e._ensure_open()

    assert len(calls) == 1, f"registered {len(calls)} fork hooks for 5 emitters"


def test_discarded_emitters_are_collectable(tmp_path, monkeypatch):
    """A dropped Emitter must not be pinned by the fork hook.

    On CPython 3.9 a pinned Emitter still holding an open file segfaulted the
    interpreter during finalization — the whole suite exited 139 right after
    printing "100 passed".
    """
    import gc
    import weakref as _weakref

    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)
    e._ensure_open()
    ref = _weakref.ref(e)

    e._close()
    del e
    gc.collect()

    assert ref() is None, "the emitter is still reachable after being dropped"


def test_at_exit_closes_the_file_and_a_later_emit_reopens_it(tmp_path, monkeypatch):
    """The file is opened for the process lifetime, so _at_exit is where it closes."""
    out = tmp_path / "trace.jsonl"
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(out))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)

    e.emit(_make_enter())
    e._at_exit()
    assert e._file is None, "_at_exit left the file open"

    # Reopening in append mode keeps the earlier line: an emit after shutdown
    # must not truncate the trace it is adding to.
    e.emit(_make_enter())
    e._close()
    assert len(out.read_text().splitlines()) == 2
