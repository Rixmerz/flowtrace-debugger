"""ContextVar-based span context for FlowTrace v2.

Each async task / thread gets its own copy of the context vars via
Python's contextvars module — no shared mutable state.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator, Optional, Tuple

from .traceparent import RemoteContext, format_traceparent, parse_traceparent

# Active W3C IDs and call depth for the current context.
current_trace_id: ContextVar[str] = ContextVar("flowtrace_trace_id", default="")
current_span_id: ContextVar[str] = ContextVar("flowtrace_span_id", default="")
current_depth: ContextVar[int] = ContextVar("flowtrace_depth", default=0)


def enter_span(trace_id: str, span_id: str) -> Tuple[Token[str], Token[str], Token[int]]:
    """Set trace_id / span_id and increment depth.

    Returns a tuple of tokens that must be passed to :func:`exit_span` to
    restore the previous values (supports nested calls correctly).
    """
    tok_trace = current_trace_id.set(trace_id)
    tok_span = current_span_id.set(span_id)
    depth = current_depth.get()
    tok_depth = current_depth.set(depth + 1)
    return tok_trace, tok_span, tok_depth


def exit_span(tokens: Tuple[Token[str], Token[str], Token[int]]) -> None:
    """Restore context vars to the values they held before :func:`enter_span`."""
    tok_trace, tok_span, tok_depth = tokens
    current_depth.reset(tok_depth)
    current_span_id.reset(tok_span)
    current_trace_id.reset(tok_trace)


@contextmanager
def remote_context(traceparent: Optional[str]) -> Iterator[Optional[RemoteContext]]:
    """Continue a trace that started in another process.

    Wrap request handling in this, passing the incoming ``traceparent``
    header. Spans created inside inherit the caller's trace_id and hang off
    the caller's span, so a browser click and the server work it triggered
    end up in one tree::

        with remote_context(request.headers.get("traceparent")):
            handle(request)

    The remote span is seeded into the context vars but never emitted — the
    remote process already emitted it. ``depth`` is seeded to 0 rather than
    -1 as in the Node runtime: this runtime reads ``current_depth`` as the
    depth *of the span about to start*, whereas Node derives it from the
    parent. Same resulting tree, different convention.

    An absent or malformed header yields ``None`` and leaves the context
    untouched, so tracing falls back to a fresh local root. A caller we do
    not control must never be able to break the traced application.
    """
    remote = parse_traceparent(traceparent)
    if remote is None:
        yield None
        return

    tok_trace = current_trace_id.set(remote.trace_id)
    tok_span = current_span_id.set(remote.parent_id)
    tok_depth = current_depth.set(0)
    try:
        yield remote
    finally:
        current_depth.reset(tok_depth)
        current_span_id.reset(tok_span)
        current_trace_id.reset(tok_trace)


def current_traceparent() -> Optional[str]:
    """The active span as a ``traceparent`` header, to propagate downstream.

    Returns ``None`` when no span is active.
    """
    return format_traceparent(current_trace_id.get(), current_span_id.get())
