"""flowtrace_runtime — public API for FlowTrace v2 Python capture."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .emitter import Emitter

__version__ = "2.0.0a1"
__all__ = [
    "install",
    "uninstall",
    "get_emitter",
    # W3C trace-context propagation. Exposed because web frameworks each
    # surface inbound headers differently and must wire themselves up.
    "continue_trace",
    "current_traceparent",
    "extract",
    "inject",
]

from .propagation import (  # noqa: E402  (public re-export)
    continue_trace,
    current_traceparent,
    extract,
    inject,
)


def install() -> None:
    """Install the FlowTrace import hook (MetaPathFinder + AST transformer)."""
    from .bootstrap import install as _install
    _install()


def uninstall() -> None:
    """Remove the FlowTrace import hook."""
    from .bootstrap import uninstall as _uninstall
    _uninstall()


def get_emitter() -> "Emitter":
    """Return the singleton JSONL emitter, creating it on first call."""
    from .emitter import Emitter
    return Emitter.instance()
