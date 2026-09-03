"""Custom SourceFileLoader that applies the FlowTrace AST transformer.

Overrides source_to_code() to:
  1. Check a bytecode cache (keyed on SHA-256 of source + versions + transform).
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
import stat
import sys
import types
from pathlib import Path

from .transformer import FlowtraceTransformer

_PY_VERSION = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def _transform_fingerprint() -> str:
    """Hash of the transform's own source, so a cached module is invalidated
    the moment the instrumentation that produced it changes. A hardcoded
    version string was here before and was not bumped when the transform
    changed, which served stale instrumented bytecode to anyone with a warm
    cache."""
    h = hashlib.sha256()
    here = Path(__file__).parent
    for name in ("transformer.py", "runtime.py"):
        try:
            h.update((here / name).read_bytes())
        except OSError:
            h.update(f"missing:{name}".encode())
        h.update(b"\0")
    return h.hexdigest()


_CAPTURE_FINGERPRINT = _transform_fingerprint()


def _cache_dir() -> Path:
    # The cache holds instrumented copies of the user's code and is loaded
    # with marshal, which trusts its input completely. Nobody else on the
    # machine gets to read it, and nobody else gets to write it.
    cache_dir = Path.home() / ".flowtrace" / "cache" / "py"
    cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        if stat.S_IMODE(cache_dir.stat().st_mode) != 0o700:
            os.chmod(cache_dir, 0o700)
    except OSError:
        pass
    return cache_dir


def _cache_path(source: bytes, path: str) -> Path:
    key = source + _CAPTURE_FINGERPRINT.encode() + _PY_VERSION.encode() + path.encode()
    digest = hashlib.sha256(key).hexdigest()
    return _cache_dir() / f"{digest}.pyc"


def _write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)


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
            _write_private(cache_file, marshal.dumps(code))
        except Exception:
            pass  # Cache write failure is non-fatal.

        return code

    def get_code(self, fullname: str) -> types.CodeType | None:  # type: ignore[override]
        # SourceFileLoader.get_code() checks the standard __pycache__ *.pyc
        # cache first and returns it without calling source_to_code() when it
        # is fresh. That cache is written by any un-instrumented run (a plain
        # `python -c "import ..."` during dev/CI) and, once present, made
        # every subsequent `flowtrace run` silently trace zero events for
        # that module. Bypassing it here forces every import through
        # source_to_code(), which has its own instrumentation-aware cache
        # keyed on a hash of the source (see _cache_path above).
        source_path = self.get_filename(fullname)
        source_bytes = self.get_data(source_path)
        return self.source_to_code(source_bytes, source_path)

    def exec_module(self, module: types.ModuleType) -> None:  # type: ignore[override]
        from .runtime import HELPERS

        module.__dict__.update(HELPERS)
        super().exec_module(module)
