"""`python dir/script.py` under the stub keeps the script's directory at sys.path[0]."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parents[3]
STUB_DIR = REPO_ROOT / "capture" / "python" / "stub"
CAPTURE_PKG = REPO_ROOT / "capture" / "python"


def _run(tmp_path: Path, prefix: str, flags: list[str] | None = None):
    sub = tmp_path / "scripts"
    sub.mkdir()
    (sub / "sibling_mod.py").write_text("VALUE = 42\n")
    (sub / "main_script.py").write_text(
        "import os, sys\n"
        "import sibling_mod\n"
        "print('dir0', os.path.samefile(sys.path[0], os.path.dirname(os.path.abspath(__file__))))\n"
        "print('value', sibling_mod.VALUE)\n"
    )
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(STUB_DIR), str(CAPTURE_PKG)]),
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": prefix,
        "FLOWTRACE_OUTPUT": str(tmp_path / "t.jsonl"),
    }
    # Run from a different cwd, with a relative script path.
    return subprocess.run([sys.executable, *(flags or []), "scripts/main_script.py"], env=env,
                          capture_output=True, text=True, timeout=60, cwd=tmp_path)


def test_script_directory_is_on_sys_path_when_instrumented(tmp_path):
    r = _run(tmp_path, "main_script")
    assert r.returncode == 0, r.stderr
    assert "dir0 True" in r.stdout and "value 42" in r.stdout


def test_script_directory_is_on_sys_path_when_not_matching_prefix(tmp_path):
    r = _run(tmp_path, "other")
    assert r.returncode == 0, r.stderr
    assert "value 42" in r.stdout
