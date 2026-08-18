"""Bootstrap: install/uninstall the FlowTrace MetaPathFinder.

Idempotent — safe to call multiple times.
"""

from __future__ import annotations

import atexit
import sys


def install() -> None:
    """Insert FlowtraceFinder at the head of sys.meta_path (idempotent)."""
    from .finder import FlowtraceFinder
    from .emitter import Emitter

    # Idempotency check.
    for finder in sys.meta_path:
        if isinstance(finder, FlowtraceFinder):
            return

    sys.meta_path.insert(0, FlowtraceFinder())

    # Adopt a traceparent left in the environment by whatever spawned us, so a
    # Python process launched from a traced Node or Java parent continues that
    # trace instead of starting an unrelated one. Absent or malformed values are
    # ignored — a bad carrier must never stop the program from running.
    from .context import seed_from_environment

    seed_from_environment()

    # Ensure emitter flushes on exit (Emitter registers its own atexit, but be explicit).
    atexit.register(Emitter.instance()._flush)


def uninstall() -> None:
    """Remove FlowtraceFinder from sys.meta_path."""
    from .finder import FlowtraceFinder

    sys.meta_path[:] = [f for f in sys.meta_path if not isinstance(f, FlowtraceFinder)]
