"""W3C trace-context propagation unit tests.

Covers parse/format round-tripping, the spec's invalidity rules, the seeded-root
depth contract that keeps seeded spans at a schema-valid depth 0, and the
inject/extract helpers frameworks are expected to call.
"""

from __future__ import annotations

import os

import pytest

from flowtrace_runtime.context import current_depth, current_span_id, current_trace_id
from flowtrace_runtime.propagation import (
    SEEDED_ROOT_DEPTH,
    TRACEPARENT,
    TRACEPARENT_ENV,
    continue_trace,
    current_traceparent,
    extract,
    format_traceparent,
    inject,
    parse_traceparent,
    seed_context,
    seed_from_env,
)

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN = "00f067aa0ba902b7"
VALID = f"00-{TRACE}-{SPAN}-01"


@pytest.fixture(autouse=True)
def _clean_context():
    """Reset the context vars around every test.

    ContextVars set via .set() without a token persist for the whole context,
    which is exactly what seed_context does — so tests must isolate explicitly
    or they leak into each other.
    """
    tokens = (
        current_trace_id.set(""),
        current_span_id.set(""),
        current_depth.set(0),
    )
    yield
    current_depth.reset(tokens[2])
    current_span_id.reset(tokens[1])
    current_trace_id.reset(tokens[0])


def test_carrier_names_are_spec_values():
    assert TRACEPARENT == "traceparent"
    assert TRACEPARENT_ENV == "FLOWTRACE_TRACEPARENT"


def test_parse_accepts_canonical_w3c_example():
    assert parse_traceparent(VALID) == (TRACE, SPAN, True)


def test_parse_reads_sampled_flag():
    assert parse_traceparent(f"00-{TRACE}-{SPAN}-01")[2] is True
    assert parse_traceparent(f"00-{TRACE}-{SPAN}-00")[2] is False
    # Only bit 0 means "sampled"; other bits must not be misread.
    assert parse_traceparent(f"00-{TRACE}-{SPAN}-03")[2] is True
    assert parse_traceparent(f"00-{TRACE}-{SPAN}-02")[2] is False


def test_parse_normalizes_case_and_whitespace():
    parsed = parse_traceparent(f"  00-{TRACE.upper()}-{SPAN.upper()}-01  ")
    assert parsed == (TRACE, SPAN, True)


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "garbage",
        42,
        {},
        f"00-{TRACE}-{SPAN}",             # missing flags
        f"00-{TRACE}",                    # missing span
        f"00-{TRACE}-{SPAN}-01-extra",    # v00 must have exactly 4 fields
        f"zz-{TRACE}-{SPAN}-01",          # non-hex version
        f"ff-{TRACE}-{SPAN}-01",          # version ff is forbidden
        f"00-{TRACE[:31]}-{SPAN}-01",     # short trace_id
        f"00-{TRACE}-{SPAN[:15]}-01",     # short span_id
        f"00-{'g' * 32}-{SPAN}-01",       # non-hex trace_id
        f"00-{TRACE}-{SPAN}-zz",          # non-hex flags
        f"00-{'0' * 32}-{SPAN}-01",       # all-zero trace_id is invalid
        f"00-{TRACE}-{'0' * 16}-01",      # all-zero span_id is invalid
    ],
)
def test_parse_rejects_malformed_without_raising(value):
    assert parse_traceparent(value) is None


def test_parse_tolerates_unknown_future_versions():
    # The spec requires forward compatibility: read the first four fields.
    assert parse_traceparent(f"01-{TRACE}-{SPAN}-01-somethingnew") == (TRACE, SPAN, True)


def test_format_round_trips():
    formatted = format_traceparent(TRACE, SPAN)
    assert formatted == VALID
    assert parse_traceparent(formatted) == (TRACE, SPAN, True)


def test_format_rejects_invalid_ids():
    assert format_traceparent(TRACE, SPAN, sampled=False) == f"00-{TRACE}-{SPAN}-00"
    assert format_traceparent("short", SPAN) is None
    assert format_traceparent(TRACE, "short") is None
    assert format_traceparent("0" * 32, SPAN) is None
    assert format_traceparent(TRACE, "0" * 16) is None
    assert format_traceparent(None, SPAN) is None


def test_seed_context_sets_vars_with_seeded_root_depth():
    assert seed_context(VALID) is True
    assert current_trace_id.get() == TRACE
    assert current_span_id.get() == SPAN
    # current_depth holds the depth the NEXT span reports, and _ft_enter emits
    # it verbatim — so a seeded root must be 0. Seeding Node's -1 here would
    # emit depth: -1 and violate the schema. Regression guard for that bug.
    assert current_depth.get() == SEEDED_ROOT_DEPTH
    assert SEEDED_ROOT_DEPTH == 0


def test_seed_context_rejects_garbage_and_leaves_vars_untouched():
    assert seed_context("garbage") is False
    assert current_trace_id.get() == ""
    assert current_span_id.get() == ""
    assert current_depth.get() == 0


def test_seed_from_env(monkeypatch):
    monkeypatch.setenv(TRACEPARENT_ENV, VALID)
    assert seed_from_env() is True
    assert current_trace_id.get() == TRACE
    assert current_span_id.get() == SPAN


def test_seed_from_env_absent_or_invalid(monkeypatch):
    monkeypatch.delenv(TRACEPARENT_ENV, raising=False)
    assert seed_from_env() is False

    monkeypatch.setenv(TRACEPARENT_ENV, "not-a-traceparent")
    assert seed_from_env() is False
    assert current_trace_id.get() == ""


def test_current_traceparent_reflects_context():
    assert current_traceparent() is None
    seed_context(VALID)
    assert current_traceparent() == VALID


def test_continue_trace_is_scoped_and_restores():
    seed_context(f"00-{'a' * 32}-{'b' * 16}-01")
    outer = current_trace_id.get()

    with continue_trace(VALID) as seeded:
        assert seeded is True
        assert current_trace_id.get() == TRACE
        assert current_span_id.get() == SPAN
        assert current_depth.get() == SEEDED_ROOT_DEPTH

    # Must restore, so concurrent requests cannot bleed into each other.
    assert current_trace_id.get() == outer


def test_continue_trace_yields_false_on_garbage():
    with continue_trace("garbage") as seeded:
        assert seeded is False
        assert current_trace_id.get() == ""


def test_continue_trace_nests():
    other_trace = "a" * 32
    with continue_trace(VALID):
        assert current_trace_id.get() == TRACE
        with continue_trace(f"00-{other_trace}-{SPAN}-01"):
            assert current_trace_id.get() == other_trace
        assert current_trace_id.get() == TRACE


def test_inject_adds_header_when_context_active():
    seed_context(VALID)
    headers: dict[str, str] = {}
    inject(headers)
    assert headers[TRACEPARENT] == VALID


def test_inject_is_a_noop_without_context():
    headers: dict[str, str] = {}
    inject(headers)
    assert headers == {}


def test_inject_never_overwrites_an_existing_header():
    seed_context(VALID)
    # An explicit caller header, or another instrumentation layer, wins.
    headers = {"TraceParent": "00-" + "c" * 32 + f"-{SPAN}-01"}
    inject(headers)
    assert headers == {"TraceParent": "00-" + "c" * 32 + f"-{SPAN}-01"}


def test_extract_is_case_insensitive():
    assert extract({"traceparent": VALID}) == VALID
    assert extract({"TraceParent": VALID}) == VALID
    assert extract({"HTTP_OTHER": "x"}) is None
    assert extract({}) is None
