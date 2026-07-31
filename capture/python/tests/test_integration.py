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
        # Asserted by shape, not by a hardcoded count. The count broke the moment
        # the golden fixture grew a plain function and an error path — coverage it
        # was missing, and whose absence hid two schema violations for a whole
        # release. A magic number makes legitimate fixture growth look like a
        # regression, so pair every enter with its exit instead.
        events = [json.loads(line) for line in lines]
        enters = [e for e in events if e["event"] == "enter"]
        exits = [e for e in events if e["event"] == "exit"]
        assert enters, f"no enter events. stderr: {result.stderr}"
        assert len(enters) == len(exits), (
            f"unpaired events: {len(enters)} enters vs {len(exits)} exits"
        )
        exited = {e["span_id"] for e in exits}
        for enter in enters:
            assert enter["span_id"] in exited, (
                f"span {enter['span_id']} ({enter['method']}) entered but never exited"
            )
        for method in ("run", "add", "_validate"):
            assert any(e["method"] == method for e in enters), f"expected {method} in trace"

        # The run() call tree must share one trace_id. Asserting it for the whole
        # FILE only held while the fixture had a single entry point: describe() and
        # must_fail() are separate top-level calls with no enclosing span, so each
        # correctly starts its own trace.
        tree_methods = {"run", "add", "_validate"}
        tree_trace_ids = {e["trace_id"] for e in events if e["method"] in tree_methods}
        assert len(tree_trace_ids) == 1, (
            f"run/add/_validate should share one trace_id, got {len(tree_trace_ids)}"
        )

        # ...and a separate top-level call must not be folded into it.
        describe_ev = next((e for e in enters if e["method"] == "describe"), None)
        assert describe_ev is not None, "plain function describe() was not traced"
        assert describe_ev["trace_id"] not in tree_trace_ids, (
            "a separate top-level call should start its own trace"
        )

        # Call tree: run -> add -> _validate x2. Asserted as the leading prefix
        # rather than the exact list, so the fixture can grow the plain-function
        # and error-path coverage it was missing without this reading as a
        # regression.
        tree_enters = [e["method"] for e in enters if e["method"] in tree_methods]
        assert tree_enters == ["run", "add", "_validate", "_validate"], tree_enters

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

        # Class field. Methods report their class; plain functions report "" — an
        # empty string, never None, because the schema types `class` as string.
        # This used to require "Calculator" on EVERY event, which only held while
        # the fixture contained nothing but methods, and is exactly why Node's
        # class:null violation went unnoticed for a release.
        for ev in events:
            assert isinstance(ev["class"], str), f"class must be a str, got {ev['class']!r}"
        for ev in events:
            if ev["method"] in tree_methods:
                assert ev["class"] == "Calculator", f"Expected Calculator, got {ev['class']}"
            else:
                assert ev["class"] == "", f"plain function should report '', got {ev['class']!r}"

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
