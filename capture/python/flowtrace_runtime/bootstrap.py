"""Bootstrap: install/uninstall the FlowTrace MetaPathFinder.

Idempotent — safe to call multiple times.
"""

from __future__ import annotations

import atexit
import sys


def install() -> None:
    """Insert FlowtraceFinder at the head of sys.meta_path (idempotent).

    Also seeds W3C trace context from the environment and installs the
    stdlib propagation patches, so a trace continues across process and
    network boundaries instead of restarting here.
    """
    from .finder import FlowtraceFinder
    from .emitter import Emitter
    from .patches import install as install_patches
    from .propagation import seed_from_env

    # Idempotency check.
    for finder in sys.meta_path:
        if isinstance(finder, FlowtraceFinder):
            return

    # Seed before any user code runs so the first local span adopts the
    # inbound trace_id rather than minting a new one.
    seed_from_env()
    install_patches()

    sys.meta_path.insert(0, FlowtraceFinder())

    # Ensure emitter flushes on exit (Emitter registers its own atexit, but be explicit).
    atexit.register(Emitter.instance()._flush)


def uninstall() -> None:
    """Remove FlowtraceFinder from sys.meta_path."""
    from .finder import FlowtraceFinder

    sys.meta_path[:] = [f for f in sys.meta_path if not isinstance(f, FlowtraceFinder)]
