"""Instrumented modules must keep __file__.

FlowtraceFinder used to rebuild the ModuleSpec from scratch. A bare ModuleSpec
defaults to has_location=False, and CPython only assigns module.__file__ when
that flag is True — so every instrumented module lost it. That is not a
cosmetic loss: `Path(__file__).parent` is the ordinary way to reach a data file
next to the source, and it raised NameError at import time, taking the
application down with it.

The fixture module is generated in a temp directory rather than committed under
tests/: anything inside capture/python/ is excluded from instrumentation so the
runtime does not rewrite itself, which would make this test silently measure
nothing.
"""
import subprocess
import sys
import textwrap
from pathlib import Path

PY_PKG = Path(__file__).resolve().parents[1]
PY_STUB = PY_PKG / "stub"


def _project(tmp_path, main_source: str) -> subprocess.CompletedProcess:
    """Writes a small package that reads __file__, then runs it instrumented."""
    pkg = tmp_path / "demo_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "uses_file.py").write_text(textwrap.dedent("""
        from pathlib import Path

        MODULE_FILE = __file__
        MODULE_DIR = Path(__file__).parent


        def file_from_function() -> str:
            return __file__
    """), encoding="utf-8")

    main = tmp_path / "main.py"
    main.write_text(textwrap.dedent(main_source), encoding="utf-8")

    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": f"{PY_STUB}:{PY_PKG}:{tmp_path}",
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": "demo_pkg",
        "FLOWTRACE_OUTPUT": str(tmp_path / "trace.jsonl"),
    }
    return subprocess.run(
        [sys.executable, str(main)],
        capture_output=True, text=True, env=env, cwd=str(tmp_path), timeout=60,
    )


def test_instrumented_module_keeps_dunder_file(tmp_path):
    res = _project(tmp_path, """
        from demo_pkg import uses_file
        print("FILE:", uses_file.MODULE_FILE)
    """)
    assert res.returncode == 0, f"import failed:\n{res.stderr}"
    assert res.stdout.split("FILE:")[1].strip().endswith("uses_file.py")


def test_dunder_file_resolves_inside_a_function(tmp_path):
    # Module scope and function scope resolve through different paths, so a fix
    # restoring only one of them would still leave the other broken.
    res = _project(tmp_path, """
        from demo_pkg import uses_file
        print("FILE:", uses_file.file_from_function())
    """)
    assert res.returncode == 0, f"call failed:\n{res.stderr}"
    assert res.stdout.split("FILE:")[1].strip().endswith("uses_file.py")


def test_path_based_on_dunder_file_still_works(tmp_path):
    # The reason this matters in practice: locating a sibling file.
    res = _project(tmp_path, """
        from demo_pkg import uses_file
        print("DIR:", uses_file.MODULE_DIR.name)
    """)
    assert res.returncode == 0, f"Path(__file__) failed:\n{res.stderr}"
    assert "DIR: demo_pkg" in res.stdout


def test_instrumentation_is_still_active(tmp_path):
    # A "fix" that restored __file__ by not instrumenting would satisfy every
    # assertion above while quietly disabling the product.
    res = _project(tmp_path, """
        from demo_pkg import uses_file
        uses_file.file_from_function()
    """)
    assert res.returncode == 0, res.stderr
    trace = tmp_path / "trace.jsonl"
    assert trace.exists(), "no trace written — instrumentation was lost"
    events = [l for l in trace.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert any("file_from_function" in e for e in events), "the traced call is absent"
