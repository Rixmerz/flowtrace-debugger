"""W3C Trace Context ID generators.

Spec: https://www.w3.org/TR/trace-context/
  trace_id  — 32 lowercase hex characters (128 bit)
  span_id   — 16 lowercase hex characters (64 bit)
"""

from __future__ import annotations

import secrets


def new_trace_id() -> str:
    """Return a fresh W3C-compliant trace ID: 32 lowercase hex characters."""
    return secrets.token_hex(16)


def new_span_id() -> str:
    """Return a fresh W3C-compliant span ID: 16 lowercase hex characters."""
    return secrets.token_hex(8)
