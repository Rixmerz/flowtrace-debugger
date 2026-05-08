"""ContextVar-based span context for FlowTrace v2.

Each async task / thread gets its own copy of the context vars via
Python's contextvars module — no shared mutable state.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Tuple

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
