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
    for name in ("transformer.py", "runtime.py", "loader.py"):
        try:
            h.update((here / name).read_bytes())
        except OSError:
            h.update(f"missing:{name}".encode())
        h.update(b"\0")
    return h.hexdigest()


_CAPTURE_FINGERPRINT = _transform_fingerprint()

# cwd when the capture layer was loaded — the default project root. Read once:
# a program that chdirs later must not change what `file` is relative to.
try:
    _START_CWD = os.getcwd()
except OSError:  # the cwd was deleted under us
    _START_CWD = ""


def project_root() -> str:
    """Directory the `file` field is relative to: FLOWTRACE_ROOT when set (a
    relative value is resolved against the starting cwd), else the cwd at
    capture start. Empty string when neither is knowable."""
    env = os.environ.get("FLOWTRACE_ROOT")
    if env:
        return os.path.normpath(os.path.join(_START_CWD, env))
    return _START_CWD


# Pin the resolved root into the environment so a child process started from
# another cwd reports paths against the same root as its parent. Without this
# each process is relative to its own cwd, and one trace holds `app.py` twice
# meaning two different files.
if project_root():
    os.environ["FLOWTRACE_ROOT"] = project_root()


def _relative_inside(root: str, path: str) -> str | None:
    try:
        rel = os.path.relpath(path, root)
    except ValueError:  # different drives on Windows
        return None
    if rel == os.curdir or rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel):
        return None
    return rel


def source_file_for(path: str, root: str | None = None) -> str | None:
    """The `file` value for a source file: a POSIX path relative to the project
    root, or the absolute POSIX path when the file is not under it. None when
    there is no real path to report."""
    if not path or path.startswith("<"):
        return None
    if root is None:
        root = project_root()
    absolute = os.path.abspath(path)
    rel = _relative_inside(root, absolute) if root else None
    if rel is None and root:
        # One side may be spelled through a symlink (macOS /tmp -> /private/tmp):
        # lexically outside, physically inside.
        try:
            rel = _relative_inside(os.path.realpath(root), os.path.realpath(absolute))
        except OSError:
            rel = None
    chosen = rel if rel is not None else absolute
    return chosen.replace(os.sep, "/") if os.sep != "/" else chosen


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


def _cache_path(source: bytes, path: str, source_file: str | None = None) -> Path:
    # `source_file` is baked into the instrumented code as the `file` of every
    # enter event, and it depends on the project root — so the same file traced
    # under another FLOWTRACE_ROOT (or from another cwd) needs its own entry.
    key = (
        source
        + _CAPTURE_FINGERPRINT.encode()
        + _PY_VERSION.encode()
        + path.encode()
        + b"\0"
        + (source_file or "").encode()
    )
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

        source_file = source_file_for(path)
        cache_file = _cache_path(source, path, source_file)

        # Cache hit.
        if cache_file.exists():
            try:
                return marshal.loads(cache_file.read_bytes())
            except Exception:
                pass  # Corrupted cache — recompute.

        # Derive module name from path for the transformer.
        module_name = Path(path).stem

        tree = ast.parse(source, filename=path)
        transformer = FlowtraceTransformer(module_name=module_name, source_file=source_file)
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
