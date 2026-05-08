"""Tests for flowtrace_runtime.context — ContextVar span helpers."""

import asyncio

import pytest

from flowtrace_runtime.context import (
    current_depth,
    current_span_id,
    current_trace_id,
    enter_span,
    exit_span,
)
from flowtrace_runtime.ids import new_span_id, new_trace_id


def test_enter_sets_vars():
    tid, sid = new_trace_id(), new_span_id()
    tokens = enter_span(tid, sid)
    assert current_trace_id.get() == tid
    assert current_span_id.get() == sid
    assert current_depth.get() == 1
    exit_span(tokens)


def test_exit_restores_vars():
    # Baseline state
    assert current_depth.get() == 0

    tid, sid = new_trace_id(), new_span_id()
    tokens = enter_span(tid, sid)
    exit_span(tokens)

    assert current_trace_id.get() == ""
    assert current_span_id.get() == ""
    assert current_depth.get() == 0


def test_nested_depth():
    tid = new_trace_id()
    t1 = enter_span(tid, new_span_id())
    assert current_depth.get() == 1
    t2 = enter_span(tid, new_span_id())
    assert current_depth.get() == 2
    exit_span(t2)
    assert current_depth.get() == 1
    exit_span(t1)
    assert current_depth.get() == 0


def test_asyncio_gather_isolation():
    """Concurrent tasks must not share context state."""

    async def task(tid: str, sid: str):
        tokens = enter_span(tid, sid)
        await asyncio.sleep(0)  # yield to event loop
        captured_tid = current_trace_id.get()
        captured_sid = current_span_id.get()
        exit_span(tokens)
        return captured_tid, captured_sid

    async def run():
        tid_a, sid_a = new_trace_id(), new_span_id()
        tid_b, sid_b = new_trace_id(), new_span_id()
        results = await asyncio.gather(task(tid_a, sid_a), task(tid_b, sid_b))
        return results, tid_a, sid_a, tid_b, sid_b

    results, tid_a, sid_a, tid_b, sid_b = asyncio.run(run())
    (r_tid_a, r_sid_a), (r_tid_b, r_sid_b) = results
    assert r_tid_a == tid_a
    assert r_sid_a == sid_a
    assert r_tid_b == tid_b
    assert r_sid_b == sid_b
