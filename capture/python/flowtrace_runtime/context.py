"""ContextVar-based span context for FlowTrace v2.

Each async task / thread gets its own copy of the context vars via
Python's contextvars module — no shared mutable state.
"""

from __future__ import annotations

import os
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
    """Restore context vars to the values they held before :func:`enter_span`.

    A generator created in one context and resumed in another (a coroutine
    driven by a different task, a generator handed across threads) makes
    ``ContextVar.reset`` raise ``ValueError: Token was created in a different
    Context``. That is a bookkeeping failure of ours, not the program's, and
    it used to escape from the injected ``finally`` straight into user code.
    The values are simply left as they are in that context.
    """
    tok_trace, tok_span, tok_depth = tokens
    for var, tok in ((current_depth, tok_depth), (current_span_id, tok_span), (current_trace_id, tok_trace)):
        try:
            var.reset(tok)
        except (ValueError, RuntimeError):
            pass


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


TRACEPARENT_ENV = "FLOWTRACE_TRACEPARENT"


def seed_from_environment(raw: Optional[str] = None) -> bool:
    """Seed this process's trace from the environment, set by whatever spawned it.

    HTTP carries trace context in a header; a process spawn has no header, so
    the environment is the carrier. ``FLOWTRACE_TRACEPARENT`` holds a plain W3C
    traceparent and every runtime reads the same name, so a Node parent can
    seed a Python child and vice versa.

    Unlike :func:`remote_context` this is not scoped to a block — there is no
    block to scope it to. It sets the context for the life of the process,
    which is exactly the span the parent's call covers, and the tokens are
    deliberately dropped since nothing will ever reset them.

    The seeded span is synthetic and never emitted: the parent already emitted
    it. ``current_depth`` is set to 0 because this runtime reads it as the
    depth of the span *about to start* — the same reason ``remote_context``
    seeds 0 where the Node runtime seeds -1.

    :param raw: Defaults to ``os.environ[TRACEPARENT_ENV]``.
    :returns: whether a valid context was adopted.
    """
    if raw is None:
        raw = os.environ.get(TRACEPARENT_ENV)
    remote = parse_traceparent(raw)
    if remote is None:
        return False
    current_trace_id.set(remote.trace_id)
    current_span_id.set(remote.parent_id)
    current_depth.set(0)
    return True
