"""Regression: error must be top-level, not nested in result."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CAPTURE = REPO / "capture" / "python"
STUB = CAPTURE / "stub"


def test_error_event_has_top_level_error_field():
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "trace.jsonl"
        src = Path(tmp) / "boom.py"
        src.write_text(
            "def boom():\n    raise KeyError('x')\n\n"
            "if __name__ == '__main__':\n    try: boom()\n    except: pass\n"
        )
        env = os.environ.copy()
        env.update({
            "PYTHONPATH": f"{tmp}:{CAPTURE}:{STUB}",
            "FLOWTRACE_ENABLE": "1",
            "FLOWTRACE_PACKAGE_PREFIX": "boom",
            "FLOWTRACE_OUTPUT": str(out),
        })
        subprocess.run(["python3", str(src)], env=env, check=False)
        lines = [json.loads(l) for l in out.read_text().splitlines() if l]
        exits_with_err = [l for l in lines if l.get("event") == "exit" and "error" in l]
        assert exits_with_err, "expected top-level error on exit event"
        e = exits_with_err[0]
        assert e["error"]["type"] == "KeyError"
        assert "error" not in e.get("result", {}), "error must not nest under result"
