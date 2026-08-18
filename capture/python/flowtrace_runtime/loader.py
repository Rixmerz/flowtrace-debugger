"""Custom SourceFileLoader that applies the FlowTrace AST transformer.

Overrides source_to_code() to:
  1. Check a bytecode cache (keyed on SHA-256 of source + versions).
  2. Parse + transform the AST.
  3. Compile and cache the result.

Also overrides exec_module() to inject __ft_* helpers before code runs.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.machinery
import marshal
import os
import sys
import types
from pathlib import Path

from .transformer import FlowtraceTransformer

_CAPTURE_VERSION = "2.1.0"
_PY_VERSION = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def _cache_path(source: bytes, path: str) -> Path:
    key = source + _CAPTURE_VERSION.encode() + _PY_VERSION.encode() + path.encode()
    digest = hashlib.sha256(key).hexdigest()
    cache_dir = Path.home() / ".flowtrace" / "cache" / "py"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{digest}.pyc"


class FlowtraceSourceLoader(importlib.machinery.SourceFileLoader):
    """SourceFileLoader subclass that injects FlowTrace instrumentation."""

    def source_to_code(  # type: ignore[override]
        self, data: bytes | str, path: str, _optimize: int = -1
    ) -> types.CodeType:
        if isinstance(data, str):
            source = data.encode("utf-8")
        else:
            source = data

        cache_file = _cache_path(source, path)

        # Cache hit.
        if cache_file.exists():
            try:
                return marshal.loads(cache_file.read_bytes())
            except Exception:
                pass  # Corrupted cache — recompute.

        # Derive module name from path for the transformer.
        module_name = Path(path).stem

        tree = ast.parse(source, filename=path)
        transformer = FlowtraceTransformer(module_name=module_name)
        transformed = transformer.visit(tree)
        ast.fix_missing_locations(transformed)

        code = compile(transformed, path, "exec", dont_inherit=True)

        try:
            cache_file.write_bytes(marshal.dumps(code))
        except Exception:
            pass  # Cache write failure is non-fatal.

        return code

    def exec_module(self, module: types.ModuleType) -> None:  # type: ignore[override]
        from .runtime import HELPERS

        module.__dict__.update(HELPERS)
        super().exec_module(module)
