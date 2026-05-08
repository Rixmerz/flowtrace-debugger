"""MetaPathFinder that intercepts imports matching FLOWTRACE_PACKAGE_PREFIX
and returns a FlowtraceSourceLoader for source files.
"""

from __future__ import annotations

import importlib.abc
import importlib.machinery
import importlib.util
import os
import sys
from importlib.machinery import ModuleSpec
from pathlib import Path
from typing import Sequence

from .loader import FlowtraceSourceLoader

_STDLIB_PATHS: frozenset[str] = frozenset(
    str(p) for p in sys.path if "site-packages" not in str(p) and str(p)
)


def _get_prefixes() -> list[str]:
    raw = os.environ.get("FLOWTRACE_PACKAGE_PREFIX", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


def _matches_prefix(name: str, prefixes: list[str]) -> bool:
    for prefix in prefixes:
        if name == prefix or name.startswith(prefix + "."):
            return True
    return False


def _is_stdlib_or_site_packages(origin: str | None) -> bool:
    if origin is None:
        return True
    path = str(origin)
    if "site-packages" in path or "dist-packages" in path:
        return True
    # Check against stdlib locations (everything in sys.prefix that isn't user code).
    stdlib_prefix = getattr(sys, "stdlib_module_names", None)
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
        spec = importlib.util.find_spec.__func__(  # type: ignore[attr-defined]
            importlib.util, name
        ) if False else None

        # Use PathFinder directly.
        from importlib.machinery import PathFinder
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
        new_spec = importlib.machinery.ModuleSpec(
            name=name,
            loader=loader,
            origin=origin,
            is_package=spec.submodule_search_locations is not None,
        )
        if spec.submodule_search_locations is not None:
            new_spec.submodule_search_locations = list(spec.submodule_search_locations)
        return new_spec
