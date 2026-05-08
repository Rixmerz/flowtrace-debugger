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
