"""`file` / `line` on enter events (schema v2, optional).

They exist so a static indexer can join a runtime span to the symbol that
declares the function, so what matters is that they name the declaration as it
is written on disk: the `def` line (not a decorator), relative to the project
root, on `enter` only, and never touched by redaction or truncation.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import textwrap
import types
from pathlib import Path

import pytest

from flowtrace_runtime import loader, runtime
from flowtrace_runtime.emitter import Emitter
from flowtrace_runtime.transformer import FlowtraceTransformer

REPO = Path(__file__).resolve().parents[3]
PY_PKG = REPO / "capture" / "python"
PY_STUB = PY_PKG / "stub"

SOURCE = textwrap.dedent('''\
    """Module docstring — with non-ASCII: héllo 日本語."""
    import functools


    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper


    @deco
    @functools.lru_cache(
        maxsize=None,
    )
    def decorated(x):
        """Docstring stays the first statement."""
        return x + 1


    class Service:
        @staticmethod
        def static_method(a):
            return a

        def method(self, a):
            def nested(b):
                return b * 2
            return nested(a)

        async def async_method(self):
            return "ok"


    async def top_async():
        return 1


    def generator():
        yield 1
''')


def _def_line(source: str, needle: str) -> int:
    """1-indexed line of the line containing `needle` — the ground truth."""
    hits = [i for i, text in enumerate(source.splitlines(), start=1) if needle in text]
    assert len(hits) == 1, f"{needle!r} must appear on exactly one line, got {hits}"
    return hits[0]


def _run_transformed(source: str, source_file: str | None):
    """Transform + exec `source`; return (module, {qualname: enter positional args})."""
    seen: dict[str, tuple] = {}

    def fake_enter(module, qualname, locals_dict, visibility, *location):
        seen[qualname] = location
        return {"qualname": qualname}

    tree = FlowtraceTransformer(module_name="m", source_file=source_file).visit(ast.parse(source))
    ast.fix_missing_locations(tree)
    mod = types.ModuleType("m")
    mod.__dict__.update(
        _ft_enter=fake_enter, _ft_exit=lambda *a: None, _ft_exit_error=lambda *a: None,
        _ft_pause=runtime._ft_pause, _ft_resume=runtime._ft_resume,
    )
    exec(compile(tree, "<m>", "exec", dont_inherit=True), mod.__dict__)  # noqa: S102
    return mod, seen


# ----------------------------------------------------------------------
# transformer: which line
# ----------------------------------------------------------------------

def test_line_is_the_def_line_for_every_kind_of_function():
    import asyncio

    mod, seen = _run_transformed(SOURCE, "pkg/mod.py")
    assert mod.decorated(1) == 2
    svc = mod.Service()
    assert svc.method(2) == 4
    assert mod.Service.static_method(5) == 5
    assert asyncio.run(svc.async_method()) == "ok"
    assert asyncio.run(mod.top_async()) == 1
    assert list(mod.generator()) == [1]

    expected = {
        # Decorated, with a decorator spanning three lines: the `def` line.
        "decorated": _def_line(SOURCE, "def decorated(x):"),
        "wrapper": _def_line(SOURCE, "def wrapper("),
        "Service.static_method": _def_line(SOURCE, "def static_method("),
        "Service.method": _def_line(SOURCE, "def method(self, a):"),
        # Nested functions are instrumented by this layer.
        "Service.nested": _def_line(SOURCE, "def nested(b):"),
        "Service.async_method": _def_line(SOURCE, "async def async_method("),
        "top_async": _def_line(SOURCE, "async def top_async("),
        "generator": _def_line(SOURCE, "def generator("),
    }
    for qualname, line in expected.items():
        assert seen[qualname] == ("pkg/mod.py", line), qualname


def test_decorated_line_is_not_the_decorator_line():
    _, seen = _run_transformed(SOURCE, "pkg/mod.py")
    # `deco` itself ran at import (it is a decorator), so it was entered.
    assert seen["deco"] == ("pkg/mod.py", _def_line(SOURCE, "def deco(fn):"))
    mod, seen = _run_transformed(SOURCE, "pkg/mod.py")
    mod.decorated(1)
    assert seen["decorated"][1] != _def_line(SOURCE, "@deco")


def test_line_matches_what_the_compiler_reports():
    """The transform must not shift lines: co_firstlineno of a function with no
    decorators is its `def` line, and it must still be after the rewrite."""
    mod, seen = _run_transformed(SOURCE, "pkg/mod.py")
    mod.Service().method(1)
    assert mod.Service.method.__code__.co_firstlineno == seen["Service.method"][1]


def test_no_source_file_means_no_location_arguments():
    mod, seen = _run_transformed(SOURCE, None)
    mod.decorated(1)
    assert seen["decorated"] == (), "omit both rather than emit a line with no file"


# ----------------------------------------------------------------------
# loader: which file
# ----------------------------------------------------------------------

def test_file_is_posix_relative_to_the_root(tmp_path):
    target = tmp_path / "src" / "pkg" / "mod.py"
    assert loader.source_file_for(str(target), str(tmp_path)) == "src/pkg/mod.py"


def test_file_outside_the_root_is_absolute(tmp_path):
    root = tmp_path / "project"
    outside = tmp_path / "elsewhere" / "mod.py"
    got = loader.source_file_for(str(outside), str(root))
    assert got == outside.as_posix()
    assert os.path.isabs(got)


def test_sibling_directory_sharing_a_name_prefix_is_outside(tmp_path):
    # /x/app-old/mod.py is not under /x/app.
    got = loader.source_file_for(str(tmp_path / "app-old" / "mod.py"), str(tmp_path / "app"))
    assert got == (tmp_path / "app-old" / "mod.py").as_posix()


def test_flowtrace_root_overrides_the_cwd(tmp_path, monkeypatch):
    target = tmp_path / "repo" / "services" / "api" / "mod.py"
    monkeypatch.setattr(loader, "_START_CWD", str(tmp_path / "repo" / "services" / "api"))
    monkeypatch.delenv("FLOWTRACE_ROOT", raising=False)
    assert loader.source_file_for(str(target)) == "mod.py"
    monkeypatch.setenv("FLOWTRACE_ROOT", str(tmp_path / "repo"))
    assert loader.source_file_for(str(target)) == "services/api/mod.py"
    # A relative FLOWTRACE_ROOT is resolved against the starting cwd.
    monkeypatch.setenv("FLOWTRACE_ROOT", "../..")
    assert loader.source_file_for(str(target)) == "services/api/mod.py"


def test_root_reached_through_a_symlink_still_yields_a_relative_path(tmp_path):
    real = tmp_path / "real"
    (real / "pkg").mkdir(parents=True)
    (real / "pkg" / "mod.py").write_text("x = 1\n", encoding="utf-8")
    link = tmp_path / "link"
    try:
        link.symlink_to(real, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks not available")
    assert loader.source_file_for(str(real / "pkg" / "mod.py"), str(link)) == "pkg/mod.py"


def test_cache_entry_depends_on_the_baked_in_file(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    a = loader._cache_path(b"x = 1\n", "/p/x.py", "x.py")
    b = loader._cache_path(b"x = 1\n", "/p/x.py", "sub/x.py")
    assert a != b, "same source under another root must not be served the old `file`"


# ----------------------------------------------------------------------
# runtime: the event
# ----------------------------------------------------------------------

def _events(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture
def emitter_file(tmp_path, monkeypatch):
    out = tmp_path / "t.jsonl"
    monkeypatch.setenv("FLOWTRACE_OUTPUT", str(out))
    monkeypatch.setattr(Emitter, "_instance", Emitter())
    runtime.reset_config()
    yield out
    runtime.reset_config()


def test_enter_carries_file_and_line_last_and_exit_does_not(emitter_file):
    ctx = runtime._ft_enter("m", "C.f", {"a": 1}, "public", "pkg/m.py", 12)
    runtime._ft_exit(ctx, 1)
    ctx = runtime._ft_enter("m", "C.g", {}, "public", "pkg/m.py", 20)
    runtime._ft_exit_error(ctx, ValueError("boom"))
    events = _events(emitter_file)
    enters = [e for e in events if e["event"] == "enter"]
    exits = [e for e in events if e["event"] == "exit"]
    assert [(e["file"], e["line"]) for e in enters] == [("pkg/m.py", 12), ("pkg/m.py", 20)]
    for e in enters:
        assert list(e)[-3:] == ["depth", "file", "line"]
    for e in exits:
        assert "file" not in e and "line" not in e


def test_location_is_optional_for_manual_callers(emitter_file):
    ctx = runtime._ft_enter("m", "f", {}, "public")
    runtime._ft_exit(ctx, None)
    enter = _events(emitter_file)[0]
    assert "file" not in enter and "line" not in enter


def test_file_is_never_redacted_or_truncated(emitter_file, monkeypatch):
    monkeypatch.setenv("FLOWTRACE_MAX_ARG_LENGTH", "8")
    monkeypatch.setenv("FLOWTRACE_REDACT_KEYS", "file,line")
    runtime.reset_config()
    path = "src/secret_token_service/password_url_email_authorization.py"
    ctx = runtime._ft_enter("m", "f", {"token": "t", "long": "x" * 100}, "public", path, 3)
    runtime._ft_exit(ctx, None)
    enter = _events(emitter_file)[0]
    assert enter["args"]["token"] == "<redacted>"
    assert enter["args"]["long"].startswith("<truncated:")
    assert enter["file"] == path and enter["line"] == 3


# ----------------------------------------------------------------------
# end to end: the real import hook, in a real interpreter
# ----------------------------------------------------------------------

def _trace(tmp_path, cwd: Path, script: Path, extra_env: dict | None = None, name: str = "t"):
    out = tmp_path / f"{name}.jsonl"
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(PY_STUB), str(PY_PKG)]),
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": "locpkg,main",
        "FLOWTRACE_OUTPUT": str(out),
        # Private bytecode cache, shared by every run of one test: that is what
        # makes the "another root" runs below a real test of the cache key.
        "HOME": str(tmp_path / "home"),
        **(extra_env or {}),
    }
    if "FLOWTRACE_ROOT" not in (extra_env or {}):
        env.pop("FLOWTRACE_ROOT", None)
    proc = subprocess.run(
        [sys.executable, str(script)], cwd=str(cwd), env=env, capture_output=True, text=True, timeout=60
    )
    assert proc.returncode == 0, proc.stderr
    return _events(out)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    pkg = root / "src" / "locpkg"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "mod.py").write_text(SOURCE, encoding="utf-8")
    (root / "main.py").write_text(
        textwrap.dedent('''\
            import sys
            sys.path.insert(0, "src")
            from locpkg import mod


            def main():
                return mod.decorated(1) + mod.Service().method(2)


            main()
        '''),
        encoding="utf-8",
    )
    return root


def test_e2e_relative_file_and_def_line(tmp_path, project):
    events = _trace(tmp_path, project, project / "main.py")
    enters = {(e["class"], e["method"]): e for e in events if e["event"] == "enter"}
    assert enters[("", "main")]["file"] == "main.py"
    assert enters[("", "main")]["line"] == 6
    assert enters[("", "decorated")]["file"] == "src/locpkg/mod.py"
    assert enters[("", "decorated")]["line"] == _def_line(SOURCE, "def decorated(x):")
    assert enters[("Service", "method")]["line"] == _def_line(SOURCE, "def method(self, a):")
    assert enters[("Service", "nested")]["line"] == _def_line(SOURCE, "def nested(b):")
    for e in events:
        if e["event"] == "enter":
            assert list(e)[-2:] == ["file", "line"]
        else:
            assert "file" not in e and "line" not in e


def test_e2e_flowtrace_root_and_file_outside_it(tmp_path, project):
    # Same sources, same cache, three roots — each must get its own `file`.
    first = _trace(tmp_path, project, project / "main.py", name="a")
    parent = _trace(
        tmp_path, project, project / "main.py", {"FLOWTRACE_ROOT": str(project.parent)}, name="b"
    )
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    outside = _trace(
        tmp_path, project, project / "main.py", {"FLOWTRACE_ROOT": str(elsewhere)}, name="c"
    )

    def file_of(events, method):
        return next(e["file"] for e in events if e["event"] == "enter" and e["method"] == method)

    assert file_of(first, "decorated") == "src/locpkg/mod.py"
    assert file_of(parent, "decorated") == "project/src/locpkg/mod.py"
    assert file_of(parent, "main") == "project/main.py"
    got = file_of(outside, "decorated")
    assert os.path.isabs(got) and "\\" not in got
    assert os.path.realpath(got) == os.path.realpath(project / "src" / "locpkg" / "mod.py")
