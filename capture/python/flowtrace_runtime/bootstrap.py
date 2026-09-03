"""Bootstrap: install/uninstall the FlowTrace MetaPathFinder.

Idempotent — safe to call multiple times.
"""

from __future__ import annotations

import contextvars
import sys
import threading

_THREAD_PATCHED = "_flowtrace_context_propagation"


def _install_thread_propagation() -> None:
    """Make ``threading.Thread`` inherit the starting thread's span.

    ``contextvars`` copies into ``asyncio`` tasks but a new thread starts with
    an EMPTY context, so every ``threading.Thread`` (and every
    ``ThreadPoolExecutor`` worker) used to begin an unrelated root trace while
    faithfully reporting its thread name — a split that looked intentional.

    ``start()`` snapshots the caller's context and the thread's ``run`` is
    executed inside that copy. The snapshot is taken at ``start()`` rather
    than at construction because that is the moment the parent hands the work
    off, and it is what ``asyncio`` does for tasks. Subclasses overriding
    ``run`` are covered: the bound method is captured, whatever it resolves to.
    """
    if getattr(threading.Thread.start, _THREAD_PATCHED, False):
        return

    original_start = threading.Thread.start

    def start(self: threading.Thread) -> None:  # type: ignore[override]
        try:
            ctx = contextvars.copy_context()
            original_run = self.run

            def run_in_context(*args: object, **kwargs: object) -> object:
                return ctx.run(original_run, *args, **kwargs)

            self.run = run_in_context  # type: ignore[method-assign]
        except Exception:
            pass  # fail open: an un-propagated thread beats a thread that never starts
        return original_start(self)

    setattr(start, _THREAD_PATCHED, True)
    threading.Thread.start = start  # type: ignore[method-assign]


def install() -> None:
    """Insert FlowtraceFinder at the head of sys.meta_path (idempotent)."""
    from .finder import FlowtraceFinder
    from .emitter import Emitter

    _install_thread_propagation()

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

    # The emitter registers its own atexit flush when first created; creating
    # it here makes that happen at install time rather than at the first span.
    Emitter.instance()


def uninstall() -> None:
    """Remove FlowtraceFinder from sys.meta_path."""
    from .finder import FlowtraceFinder

    sys.meta_path[:] = [f for f in sys.meta_path if not isinstance(f, FlowtraceFinder)]
