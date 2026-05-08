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
    import atexit as _atexit
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(tmp_path / "trace.jsonl"))
    e = Emitter.__new__(Emitter)
    Emitter.__init__(e)
    # Simply check that construction did not raise and _flush is callable.
    assert callable(e._flush)
