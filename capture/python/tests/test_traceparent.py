"""W3C traceparent parsing/formatting and cross-process context adoption."""

import pytest

from flowtrace_runtime.context import (
    current_depth,
    current_span_id,
    current_trace_id,
    current_traceparent,
    enter_span,
    exit_span,
    remote_context,
)
from flowtrace_runtime.traceparent import format_traceparent, parse_traceparent

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN = "00f067aa0ba902b7"
HEADER = "00-{0}-{1}-01".format(TRACE, SPAN)


def test_parses_canonical_example():
    r = parse_traceparent(HEADER)
    assert r.trace_id == TRACE
    assert r.parent_id == SPAN
    assert r.flags == 1
    assert r.sampled is True


def test_sampled_false_when_bit_clear():
    r = parse_traceparent("00-{0}-{1}-00".format(TRACE, SPAN))
    assert r.sampled is False


def test_sampled_reads_bit_zero_only():
    assert parse_traceparent("00-{0}-{1}-fe".format(TRACE, SPAN)).sampled is False
    assert parse_traceparent("00-{0}-{1}-ff".format(TRACE, SPAN)).sampled is True


@pytest.mark.parametrize(
    "header",
    [
        "00-{0}-{1}-01".format("0" * 32, SPAN),          # all-zero trace id
        "00-{0}-{1}-01".format(TRACE, "0" * 16),         # all-zero parent id
        "ff-{0}-{1}-01".format(TRACE, SPAN),             # forbidden version
        "00-{0}-{1}-01".format(TRACE.upper(), SPAN),     # uppercase hex
        "00-{0}-{1}-01".format(TRACE, SPAN.upper()),
        "00-{0}-{1}-01".format(TRACE[:31], SPAN),        # short trace id
        "00-{0}-{1}-01".format(TRACE, SPAN[:15]),        # short parent id
        "00-{0}a-{1}-01".format(TRACE, SPAN),            # long trace id
        "00-{0}-{1}-01".format("g" * 32, SPAN),          # non-hex
        "0z-{0}-{1}-01".format(TRACE, SPAN),             # non-hex version
        "{0}-extra".format(HEADER),                       # trailing field on v00
        "00-{0}-{1}".format(TRACE, SPAN),                # too few fields
        "00",
        "",
    ],
)
def test_rejects_malformed(header):
    assert parse_traceparent(header) is None


def test_accepts_trailing_fields_on_future_version():
    # The spec requires forward compatibility: parse what we understand.
    r = parse_traceparent("01-{0}-{1}-01-future-stuff".format(TRACE, SPAN))
    assert r.trace_id == TRACE
    assert r.parent_id == SPAN


@pytest.mark.parametrize("bad", [None, 42, {}, True, b"bytes"])
def test_rejects_non_string_instead_of_raising(bad):
    # A caller we do not control must not be able to crash the traced app.
    assert parse_traceparent(bad) is None


def test_format_and_round_trip():
    header = format_traceparent(TRACE, SPAN)
    assert header == HEADER
    assert parse_traceparent(header).trace_id == TRACE


@pytest.mark.parametrize(
    "trace_id,span_id",
    [(TRACE, "0" * 16), ("0" * 32, SPAN), ("nope", SPAN), (TRACE, "nope"), (None, SPAN)],
)
def test_format_rejects_invalid_ids(trace_id, span_id):
    assert format_traceparent(trace_id, span_id) is None


def test_adopts_remote_trace_id():
    with remote_context(HEADER):
        assert current_trace_id.get() == TRACE


def test_first_local_span_hangs_off_remote_span():
    with remote_context(HEADER):
        # The seeded span_id is the caller's, so the first local span's
        # parent_id resolves to the remote span.
        assert current_span_id.get() == SPAN


def test_first_local_span_is_at_depth_zero():
    with remote_context(HEADER):
        # This runtime reads current_depth as the depth of the span about to
        # start, so 0 here means the first local span reports depth 0.
        assert current_depth.get() == 0


def test_nested_spans_increment_depth_under_remote_root():
    with remote_context(HEADER):
        tokens = enter_span(current_trace_id.get(), "1" * 16)
        try:
            assert current_depth.get() == 1
            assert current_trace_id.get() == TRACE
        finally:
            exit_span(tokens)


def test_malformed_header_leaves_context_untouched():
    with remote_context("total garbage") as remote:
        assert remote is None
        assert current_trace_id.get() == ""


def test_context_is_restored_after_block():
    assert current_trace_id.get() == ""
    with remote_context(HEADER):
        assert current_trace_id.get() == TRACE
    assert current_trace_id.get() == ""


def test_context_restored_even_when_body_raises():
    with pytest.raises(ValueError):
        with remote_context(HEADER):
            raise ValueError("boom")
    assert current_trace_id.get() == ""


def test_current_traceparent_renders_active_span():
    tokens = enter_span(TRACE, SPAN)
    try:
        assert current_traceparent() == HEADER
    finally:
        exit_span(tokens)


def test_current_traceparent_carries_adopted_trace_onward():
    with remote_context(HEADER):
        tokens = enter_span(current_trace_id.get(), "c" * 16)
        try:
            # browser -> python -> next hop: trace_id survives both legs.
            assert current_traceparent() == "00-{0}-{1}-01".format(TRACE, "c" * 16)
        finally:
            exit_span(tokens)


def test_current_traceparent_is_none_outside_any_span():
    assert current_traceparent() is None
