"""MetaPathFinder that intercepts imports matching FLOWTRACE_PACKAGE_PREFIX
and returns a FlowtraceSourceLoader for source files.
"""

from __future__ import annotations

import importlib.abc
import os
from importlib.machinery import ModuleSpec, PathFinder
from typing import Sequence

from .loader import FlowtraceSourceLoader


def _get_prefixes() -> list[str]:
    raw = os.environ.get("FLOWTRACE_PACKAGE_PREFIX", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


def _matches_prefix(name: str, prefixes: list[str]) -> bool:
    for prefix in prefixes:
        if name == prefix or name.startswith(prefix + "."):
            return True
    return False


class FlowtraceFinder(importlib.abc.MetaPathFinder):
    """MetaPathFinder that wraps matching source modules with FlowtraceSourceLoader."""

    def find_spec(
        self,
        name: str,
        path: Sequence[str] | None,
        target: object = None,
    ) -> ModuleSpec | None:
        prefixes = _get_prefixes()
        if not prefixes:
            return None
        if not _matches_prefix(name, prefixes):
            return None

        # Delegate to PathFinder to locate the source file.
        spec = PathFinder.find_spec(name, path)
        if spec is None or spec.origin is None:
            return None

        origin = spec.origin
        if not origin.endswith(".py"):
            return None

        # Skip site-packages / stdlib unless prefix explicitly targets them.
        if "site-packages" in origin or "dist-packages" in origin:
            return None

        loader = FlowtraceSourceLoader(name, origin)
        # Mutate the spec PathFinder already built rather than constructing a
        # fresh one. A bare ModuleSpec defaults to has_location=False, and
        # CPython only assigns module.__file__ when that flag is True — so
        # rebuilding it silently removed __file__ from every instrumented
        # module. Anything doing Path(__file__).parent, which is the ordinary
        # way to reach a data file next to the source, died with NameError.
        spec.loader = loader
        return spec
