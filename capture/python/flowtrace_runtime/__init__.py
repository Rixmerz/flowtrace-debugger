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
    "remote_context",
    "current_traceparent",
]

# Re-exported directly rather than lazily: these are cheap (contextvars only,
# no import hook, no emitter) and a framework integration reaches for them on
# the request path, where a lazy import on every call would be wasteful.
from .context import current_traceparent, remote_context  # noqa: E402


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
