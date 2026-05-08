"""Integration test: run calculator.py under FlowTrace and validate JSONL output."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[3]
GOLDEN_PY = REPO_ROOT / "examples" / "golden" / "python" / "calculator.py"
STUB_DIR = REPO_ROOT / "capture" / "python" / "stub"
CAPTURE_PKG = REPO_ROOT / "capture" / "python"


def _original_sha256() -> str:
    return hashlib.sha256(GOLDEN_PY.read_bytes()).hexdigest()


@pytest.mark.skipif(not GOLDEN_PY.exists(), reason="golden calculator.py not found")
def test_integration_calculator():
    original_hash = _original_sha256()

    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as tmp:
        out_path = tmp.name

    try:
        existing_pythonpath = os.environ.get("PYTHONPATH", "")
        pythonpath_parts = [str(STUB_DIR), str(CAPTURE_PKG)]
        if existing_pythonpath:
            pythonpath_parts.append(existing_pythonpath)
        pythonpath = os.pathsep.join(pythonpath_parts)

        env = {
            **os.environ,
            "PYTHONPATH": pythonpath,
            "FLOWTRACE_ENABLE": "1",
            "FLOWTRACE_PACKAGE_PREFIX": "calculator",
            "FLOWTRACE_OUTPUT": out_path,
        }

        result = subprocess.run(
            [sys.executable, str(GOLDEN_PY)],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            pytest.fail(f"calculator.py failed:\nstdout: {result.stdout}\nstderr: {result.stderr}")

        lines = Path(out_path).read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 8, f"Expected 8 JSONL lines, got {len(lines)}. stderr: {result.stderr}"

        events = [json.loads(line) for line in lines]

        # All events share same trace_id.
        trace_ids = {e["trace_id"] for e in events}
        assert len(trace_ids) == 1, "Expected single trace_id"

        # Enter/exit counts.
        enters = [e for e in events if e["event"] == "enter"]
        exits = [e for e in events if e["event"] == "exit"]
        assert len(enters) == 4
        assert len(exits) == 4

        # Call tree: run -> add -> _validate x2.
        enter_methods = [e["method"] for e in enters]
        assert enter_methods == ["run", "add", "_validate", "_validate"]

        # Visibility.
        validate_events = [e for e in events if e["method"] == "_validate"]
        for ev in validate_events:
            assert ev["visibility"] == "private", f"_validate should be private, got {ev['visibility']}"

        # Depth tree.
        run_enter = next(e for e in enters if e["method"] == "run")
        add_enter = next(e for e in enters if e["method"] == "add")
        validate_enters = [e for e in enters if e["method"] == "_validate"]

        assert run_enter["depth"] == 0
        assert add_enter["depth"] == 1
        assert all(e["depth"] == 2 for e in validate_enters)

        # Class field.
        for ev in events:
            assert ev["class"] == "Calculator", f"Expected class=Calculator, got {ev['class']}"

        # Source file unchanged (zero modification check).
        assert _original_sha256() == original_hash, "calculator.py was modified!"

    finally:
        Path(out_path).unlink(missing_ok=True)


@pytest.mark.skipif(not GOLDEN_PY.exists(), reason="golden calculator.py not found")
def test_source_not_modified():
    """Verify calculator.py SHA-256 is stable across two reads (sanity)."""
    h1 = _original_sha256()
    h2 = _original_sha256()
    assert h1 == h2


def test_instrumented_module_preserves_dunder_file():
    """Regression: FlowtraceFinder must preserve spec.has_location so __file__ is set.

    Reason: a previous implementation rebuilt ModuleSpec without copying
    has_location=True, which made CPython skip assigning module.__file__.
    User code relying on Path(__file__).parent or pkg.__file__ then broke.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        pkg_dir = Path(tmpdir) / "ft_pkg_dunder"
        pkg_dir.mkdir()
        (pkg_dir / "__init__.py").write_text("", encoding="utf-8")
        mod_path = pkg_dir / "leaf.py"
        mod_path.write_text(
            "from pathlib import Path\n"
            "MY_FILE = __file__\n"
            "MY_PARENT = str(Path(__file__).parent)\n"
            "def hello():\n"
            "    return MY_FILE\n",
            encoding="utf-8",
        )

        probe = (
            "import sys, json\n"
            f"sys.path.insert(0, {str(tmpdir)!r})\n"
            "import ft_pkg_dunder.leaf as m\n"
            "print(json.dumps({'file': m.__file__, 'my_file': m.MY_FILE, 'parent': m.MY_PARENT, 'hello': m.hello()}))\n"
        )

        existing_pythonpath = os.environ.get("PYTHONPATH", "")
        pythonpath = os.pathsep.join(
            [str(STUB_DIR), str(CAPTURE_PKG)] + ([existing_pythonpath] if existing_pythonpath else [])
        )

        env = {
            **os.environ,
            "PYTHONPATH": pythonpath,
            "FLOWTRACE_ENABLE": "1",
            "FLOWTRACE_PACKAGE_PREFIX": "ft_pkg_dunder",
        }
        env.pop("FLOWTRACE_OUTPUT", None)

        result = subprocess.run(
            [sys.executable, "-c", probe],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert result.returncode == 0, f"probe failed: {result.stderr}"
        payload = json.loads(result.stdout.strip().splitlines()[-1])

        expected_file = str(mod_path)
        assert payload["file"] == expected_file, f"module.__file__ mismatch: {payload}"
        assert payload["my_file"] == expected_file, f"top-level __file__ broken: {payload}"
        assert payload["parent"] == str(pkg_dir), f"Path(__file__).parent broken: {payload}"
        assert payload["hello"] == expected_file, f"function-scope __file__ broken: {payload}"
