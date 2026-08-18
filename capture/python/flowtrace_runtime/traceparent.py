"""W3C Trace Context — ``traceparent`` header parsing and formatting.

Spec: https://www.w3.org/TR/trace-context/#traceparent-header

::

    traceparent = version "-" trace-id "-" parent-id "-" trace-flags
    version     = 2 HEXDIGLC   ; "ff" is forbidden
    trace-id    = 32 HEXDIGLC  ; all-zero is invalid
    parent-id   = 16 HEXDIGLC  ; all-zero is invalid
    trace-flags = 2 HEXDIGLC   ; bit 0 = sampled

HEXDIGLC is *lowercase* hex — uppercase is rejected rather than normalized.
The spec is explicit, and being lenient would let us emit a trace_id that
fails our own schema (``^[0-9a-f]{32}$``).

This is what lets one logical request keep a single trace_id across process
boundaries. Without it every process mints its own root and the resulting
trees can never be joined.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

_HEX_LC = frozenset("0123456789abcdef")
_INVALID_TRACE_ID = "0" * 32
_INVALID_SPAN_ID = "0" * 16


def _is_hex(value: str, length: int) -> bool:
    """Lowercase-hex test of an exact length."""
    return len(value) == length and all(c in _HEX_LC for c in value)


@dataclass(frozen=True)
class RemoteContext:
    """A trace context extracted from an incoming ``traceparent`` header."""

    trace_id: str
    parent_id: str
    flags: int

    @property
    def sampled(self) -> bool:
        return bool(self.flags & 0x01)


def parse_traceparent(header: Optional[str]) -> Optional[RemoteContext]:
    """Parse a ``traceparent`` header value.

    Returns ``None`` for anything invalid rather than raising — a malformed
    header from a caller we do not control must degrade to "start a new
    trace", never break the traced application.
    """
    if not isinstance(header, str):
        return None

    parts = header.split("-")
    if len(parts) < 4:
        return None

    version, trace_id, parent_id, flags = parts[0], parts[1], parts[2], parts[3]

    if not _is_hex(version, 2) or version == "ff":
        return None

    # Version 00 is exactly four fields. Later versions may append more and the
    # spec requires accepting those by parsing the fields we understand — so
    # extra trailing fields are tolerated only when the version says so.
    if version == "00" and len(parts) != 4:
        return None

    if not _is_hex(trace_id, 32) or trace_id == _INVALID_TRACE_ID:
        return None
    if not _is_hex(parent_id, 16) or parent_id == _INVALID_SPAN_ID:
        return None
    if not _is_hex(flags, 2):
        return None

    return RemoteContext(trace_id=trace_id, parent_id=parent_id, flags=int(flags, 16))


def format_traceparent(trace_id: str, span_id: str) -> Optional[str]:
    """Build a ``traceparent`` header value for an outgoing call.

    Always emits version 00 with the sampled flag set: a span only reaches
    this code path because it was captured, so from the peer's perspective
    this trace is sampled.

    Returns ``None`` if the ids are not valid W3C ids.
    """
    if not isinstance(trace_id, str) or not isinstance(span_id, str):
        return None
    if not _is_hex(trace_id, 32) or trace_id == _INVALID_TRACE_ID:
        return None
    if not _is_hex(span_id, 16) or span_id == _INVALID_SPAN_ID:
        return None
    return "00-{0}-{1}-01".format(trace_id, span_id)
