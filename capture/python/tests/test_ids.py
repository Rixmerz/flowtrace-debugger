"""Tests for flowtrace_runtime.ids — W3C ID generators."""

import re

from flowtrace_runtime.ids import new_span_id, new_trace_id

TRACE_RE = re.compile(r"^[0-9a-f]{32}$")
SPAN_RE = re.compile(r"^[0-9a-f]{16}$")


def test_new_trace_id_format():
    tid = new_trace_id()
    assert TRACE_RE.match(tid), f"bad trace_id: {tid!r}"


def test_new_span_id_format():
    sid = new_span_id()
    assert SPAN_RE.match(sid), f"bad span_id: {sid!r}"


def test_new_trace_id_uniqueness():
    ids = {new_trace_id() for _ in range(1000)}
    assert len(ids) == 1000, "trace_id collision detected"


def test_new_span_id_uniqueness():
    ids = {new_span_id() for _ in range(1000)}
    assert len(ids) == 1000, "span_id collision detected"
