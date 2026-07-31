"""W3C Trace Context propagation for FlowTrace v2.

Until this module existed, ``_ft_enter`` fell back to ``new_trace_id()`` whenever
no in-process context was active, so a trace died at the process boundary: two
services in a request chain produced two unrelated traces and cross-repo call
trees were impossible. This module carries trace_id/span_id across boundaries in
the standard ``traceparent`` form, so the MCP server's parent_id linking (which
is already file-agnostic) reconstructs a single tree spanning every service.

Format (W3C Trace Context Level 1, version 00)::

    00-<32 hex trace_id>-<16 hex span_id>-<2 hex flags>

Carriers supported:

- env ``FLOWTRACE_TRACEPARENT`` — process boundaries (subprocess, CLI chains)
- HTTP header ``traceparent``   — network boundaries

The seeding mechanism differs from Node's by design. ``_ft_enter`` already
derives its parent from the ``current_trace_id`` / ``current_span_id``
ContextVars, so seeding is simply *setting those vars* — no change to the hot
path is required.

Depth needs care, because the two runtimes use opposite internal conventions for
the same observable output:

- Node's context holds the **parent's** depth and each span computes
  ``parent.depth + 1``. A seeded remote parent there carries depth -1 so the
  first local span lands on 0.
- Python's ``current_depth`` holds the depth the **next** span will use
  (``runtime._ft_enter`` emits ``current_depth.get()`` verbatim). So a seeded
  root must set it to 0, not -1 — seeding -1 would emit ``depth: -1`` and
  violate the schema's ``depth >= 0`` constraint.

.. seealso:: https://www.w3.org/TR/trace-context/
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from typing import Iterator, Mapping, MutableMapping

from .context import current_depth, current_span_id, current_trace_id

#: Header / env carrier name (lowercase per spec).
TRACEPARENT = "traceparent"

#: Env var used to seed a root context across process boundaries.
TRACEPARENT_ENV = "FLOWTRACE_TRACEPARENT"

_TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SPAN_ID_RE = re.compile(r"^[0-9a-f]{16}$")
_FLAGS_RE = re.compile(r"^[0-9a-f]{2}$")

# All-zero IDs are explicitly invalid per the W3C spec.
_NULL_TRACE_ID = "0" * 32
_NULL_SPAN_ID = "0" * 16

#: Depth the first span after a seed must report. ``current_depth`` holds the
#: depth of the *next* span (not the parent's), so this is 0 — see the module
#: docstring for why it differs from Node's -1.
SEEDED_ROOT_DEPTH = 0


def parse_traceparent(value: str | None) -> tuple[str, str, bool] | None:
    """Parse a ``traceparent`` value into ``(trace_id, span_id, sampled)``.

    Returns ``None`` for anything malformed rather than raising — a bad upstream
    header must never break the traced application. Unknown future versions are
    accepted when the first four fields still parse, as the spec requires.
    """
    if not isinstance(value, str):
        return None

    parts = value.strip().lower().split("-")
    if len(parts) < 4:
        return None

    version, trace_id, span_id, flags = parts[0], parts[1], parts[2], parts[3]

    # "ff" is forbidden; anything else is a version whose first four fields we
    # can still read.
    if not _FLAGS_RE.match(version) or version == "ff":
        return None
    if not _TRACE_ID_RE.match(trace_id) or trace_id == _NULL_TRACE_ID:
        return None
    if not _SPAN_ID_RE.match(span_id) or span_id == _NULL_SPAN_ID:
        return None
    if not _FLAGS_RE.match(flags):
        return None
    # Version 00 has exactly four fields; extras mean a malformed v00 header.
    if version == "00" and len(parts) != 4:
        return None

    return trace_id, span_id, bool(int(flags, 16) & 0x01)


def format_traceparent(trace_id: str, span_id: str, sampled: bool = True) -> str | None:
    """Serialize IDs into a ``traceparent`` value, or ``None`` if invalid."""
    if not isinstance(trace_id, str) or not _TRACE_ID_RE.match(trace_id):
        return None
    if trace_id == _NULL_TRACE_ID:
        return None
    if not isinstance(span_id, str) or not _SPAN_ID_RE.match(span_id):
        return None
    if span_id == _NULL_SPAN_ID:
        return None
    return f"00-{trace_id}-{span_id}-{'01' if sampled else '00'}"


def seed_context(value: str | None) -> bool:
    """Seed the ContextVars from a ``traceparent`` value.

    Sets the vars for the *current* context permanently (no token is returned),
    which is what a process-wide root seed needs. Use :func:`continue_trace` for
    a scoped seed, e.g. per inbound request.

    :return: ``True`` if a valid context was seeded.
    """
    parsed = parse_traceparent(value)
    if parsed is None:
        return False
    trace_id, span_id, _ = parsed
    current_trace_id.set(trace_id)
    current_span_id.set(span_id)
    current_depth.set(SEEDED_ROOT_DEPTH)
    return True


def seed_from_env() -> bool:
    """Seed the root context from ``FLOWTRACE_TRACEPARENT``.

    Called by :func:`flowtrace_runtime.install`. Returns ``True`` if a valid
    context was found and seeded.
    """
    return seed_context(os.environ.get(TRACEPARENT_ENV))


def current_traceparent() -> str | None:
    """The ``traceparent`` for the active span, for outbound injection.

    Returns ``None`` when no context is active, so callers can skip injecting
    a header rather than emitting a meaningless one.
    """
    trace_id = current_trace_id.get()
    span_id = current_span_id.get()
    if not trace_id or not span_id:
        return None
    return format_traceparent(trace_id, span_id)


@contextmanager
def continue_trace(value: str | None) -> Iterator[bool]:
    """Scoped seed — run a block as a child of a remote span.

    This is the integration point for web frameworks, which each expose inbound
    headers differently. Wrap request handling in it::

        with continue_trace(request.headers.get("traceparent")):
            handle(request)

    Restores the previous context on exit, so it is safe under concurrency and
    for nested use. Yields ``True`` if a valid context was seeded.
    """
    parsed = parse_traceparent(value)
    if parsed is None:
        yield False
        return

    trace_id, span_id, _ = parsed
    tok_trace = current_trace_id.set(trace_id)
    tok_span = current_span_id.set(span_id)
    tok_depth = current_depth.set(SEEDED_ROOT_DEPTH)
    try:
        yield True
    finally:
        current_depth.reset(tok_depth)
        current_span_id.reset(tok_span)
        current_trace_id.reset(tok_trace)


def inject(headers: MutableMapping[str, str]) -> MutableMapping[str, str]:
    """Add ``traceparent`` to an outbound header mapping, in place.

    An existing ``traceparent`` is never overwritten: an explicit caller header,
    or another instrumentation layer, wins.
    """
    traceparent = current_traceparent()
    if traceparent is None:
        return headers
    if not any(k.lower() == TRACEPARENT for k in headers):
        headers[TRACEPARENT] = traceparent
    return headers


def extract(headers: Mapping[str, str]) -> str | None:
    """Pull the ``traceparent`` value out of an inbound header mapping.

    Case-insensitive, so it works with both raw WSGI dicts and framework
    header objects.
    """
    for key, value in headers.items():
        if key.lower() == TRACEPARENT:
            return value
    return None
