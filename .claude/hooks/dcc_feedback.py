#!/usr/bin/env python3
"""DCC Feedback Hook — PostToolUse hook for Edit/Write.

Accumulates edited files in a batch and, once the batch is mature
(BATCH_COOLDOWN_S seconds of quiet OR MAX_BATCH_FILES files reached),
compares the current DCC smells cache against the last baseline.
New smells that appeared in the files Claude just touched are printed
to stderr so Claude can self-correct.

Protocol:
  stdin:  {"tool_name": "Edit", "tool_input": {"file_path": "..."}, "tool_result": {...}}
  stdout: {"decision": "approve"}   (always — never blocks)
  stderr: DCC delta warning (optional, only when new smells found)
  exit 0: always
"""

import json
import os
import sys
import time
from pathlib import Path

_APPROVE = json.dumps({"decision": "approve"})

# ---------------------------------------------------------------------------
# Paths (<project-root> is replaced by hookService.ts at install time)
# ---------------------------------------------------------------------------
_PROJECT_PATH = os.environ.get("CLAUDE_PROJECT_DIR", "<project-root>")
_HOOKS_DIR = Path(_PROJECT_PATH) / ".claude" / "hooks"
_CACHE_FILE = _HOOKS_DIR / ".dcc_smells_cache.json"
_BASELINE_FILE = _HOOKS_DIR / ".dcc_smells_baseline.json"
_BATCH_FILE = _HOOKS_DIR / ".dcc_batch.json"

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------
BATCH_COOLDOWN_S = 8   # Seconds of quiet before analyzing
MAX_BATCH_FILES = 5    # Force analyze after this many distinct files

# ---------------------------------------------------------------------------
# Severity ordering (highest first)
# ---------------------------------------------------------------------------
_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _generate_smells_cache() -> dict | None:
    """Generate smells cache by running DCC SmellDetector via subprocess.

    Falls back to this when the frontend file watcher hasn't written
    .dcc_smells_cache.json (e.g., DCC not indexed from UI yet).
    """
    try:
        import subprocess
        dcc_src = Path.home() / ".local" / "share" / "jig" / ".deltacodecube" / "src"
        if not dcc_src.exists():
            return None

        script = f"""
import sys, json
sys.path.insert(0, {str(dcc_src)!r})
try:
    from deltacodecube.db.database import get_connection
    from deltacodecube.cube.smells import SmellDetector
    with get_connection() as conn:
        detector = SmellDetector(conn)
        smells = detector.detect_all()
        result = [s.to_dict() for s in smells[:50]]
        print(json.dumps(result))
except Exception as e:
    print(json.dumps([]))
"""
        result = subprocess.run(
            ["python3", "-c", script],
            capture_output=True, text=True, timeout=4,
            cwd=str(Path.home() / ".local" / "share" / "jig" / ".deltacodecube"),
        )
        if result.returncode != 0:
            return None

        smells = json.loads(result.stdout.strip())
        if not isinstance(smells, list):
            return None

        by_type: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        for s in smells:
            t = s.get("type", "")
            sev = s.get("severity", "")
            if t:
                by_type[t] = by_type.get(t, 0) + 1
            if sev:
                by_severity[sev] = by_severity.get(sev, 0) + 1

        return {
            "timestamp": int(time.time() * 1000),
            "smells": smells,
            "by_type": by_type,
            "by_severity": by_severity,
            "total": len(smells),
        }
    except Exception:
        return None


def _load_json(path: Path, default):
    """Load JSON from path, returning default on any error."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _save_json(path: Path, data) -> None:
    """Write JSON to path, silently ignoring errors."""
    try:
        path.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def _load_batch() -> dict:
    """Load or initialise the batch accumulator."""
    batch = _load_json(_BATCH_FILE, None)
    if (
        not isinstance(batch, dict)
        or "files" not in batch
        or "first_edit_ts" not in batch
        or "last_edit_ts" not in batch
    ):
        batch = {"files": [], "first_edit_ts": None, "last_edit_ts": None}
    return batch


def _smell_key(smell: dict) -> tuple:
    return (smell.get("type", ""), smell.get("file_path", ""))


def _compute_delta(
    current_smells: list,
    baseline_smells: list,
    edited_files: set,
) -> list:
    """Return smells that are new (not in baseline) AND in files Claude edited."""
    baseline_keys = {_smell_key(s) for s in baseline_smells}
    new_smells = []
    for smell in current_smells:
        key = _smell_key(smell)
        if key in baseline_keys:
            continue
        # Only surface smells in files Claude actually touched
        smell_file = smell.get("file_path", "")
        if smell_file not in edited_files:
            continue
        new_smells.append(smell)

    # Sort: critical → high → medium → low
    new_smells.sort(
        key=lambda s: _SEVERITY_ORDER.get(s.get("severity", "low"), 3)
    )
    return new_smells


def _filter_actionable_smells(smells: list, project_dir: str) -> list:
    """Filter out orphan_file smells for new/untracked files. Standalone version."""
    import subprocess
    new_files: set = set()
    try:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=project_dir, capture_output=True, text=True, timeout=2
        )
        if r.returncode == 0:
            for line in r.stdout.strip().split("\n"):
                if line and line[0] in ("?", "A"):
                    new_files.add(line[3:].strip())
    except Exception:
        pass
    try:
        r2 = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=A", "HEAD~1"],
            cwd=project_dir, capture_output=True, text=True, timeout=2
        )
        if r2.returncode == 0:
            for line in r2.stdout.strip().split("\n"):
                if line.strip():
                    new_files.add(line.strip())
    except Exception:
        pass
    if not new_files:
        return smells
    filtered = []
    for smell in smells:
        if smell.get("type") == "orphan_file" or smell.get("smell_type") == "orphan":
            fp = smell.get("file_path", smell.get("file", ""))
            if fp in new_files:
                continue
        filtered.append(smell)
    return filtered


def _truncate_path(path: str, max_len: int = 60) -> str:
    """Shorten a path so each line stays under 100 chars."""
    if len(path) <= max_len:
        return path
    return "..." + path[-(max_len - 3):]


def _format_delta(new_smells: list, num_files: int) -> str:
    """Return a compact human-readable summary of new smells."""
    MAX_SHOWN = 5
    shown = new_smells[:MAX_SHOWN]
    remainder = len(new_smells) - MAX_SHOWN

    header = (
        f"\u26a0 DCC: +{len(new_smells)} new smell"
        f"{'s' if len(new_smells) != 1 else ''} "
        f"after editing {num_files} file{'s' if num_files != 1 else ''}"
    )
    lines = [header]

    for smell in shown:
        smell_type = smell.get("type", "unknown")
        severity = smell.get("severity", "?")
        file_path = _truncate_path(smell.get("file_path", ""))
        description = smell.get("description", "")
        # Build the line and trim so it stays under 100 chars
        line = f"  \u2022 {smell_type} ({severity}): {file_path}"
        if description:
            candidate = f"{line} \u2014 {description}"
            line = candidate if len(candidate) <= 98 else candidate[:95] + "..."
        lines.append(line)

    if remainder > 0:
        lines.append(
            f"  ... and {remainder} more "
            "(call graph_mid_phase_dcc for full report)"
        )

    return "\n".join(lines)


def main():
    # ------------------------------------------------------------------
    # 1. Parse stdin
    # ------------------------------------------------------------------
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", tool_input.get("path", ""))
    if not file_path:
        print(_APPROVE)
        return

    # ------------------------------------------------------------------
    # 2. Update batch
    # ------------------------------------------------------------------
    batch = _load_batch()

    files_set = set(batch["files"])
    files_set.add(file_path)
    batch["files"] = list(files_set)

    now = time.time()
    if batch["first_edit_ts"] is None:
        batch["first_edit_ts"] = now
    batch["last_edit_ts"] = now

    _save_json(_BATCH_FILE, batch)

    # ------------------------------------------------------------------
    # 3. Check trigger condition
    # ------------------------------------------------------------------
    age_s = now - batch["first_edit_ts"]
    triggered = age_s >= BATCH_COOLDOWN_S or len(batch["files"]) >= MAX_BATCH_FILES

    if not triggered:
        print(_APPROVE)
        return

    # ------------------------------------------------------------------
    # 4. Load smells — try cache first, fallback to running DCC inline
    # ------------------------------------------------------------------
    cache_data = _load_json(_CACHE_FILE, None) if _CACHE_FILE.exists() else None

    if not isinstance(cache_data, dict) or not cache_data.get("smells"):
        # Cache missing or empty — generate smells by running DCC SmellDetector inline
        cache_data = _generate_smells_cache()
        if cache_data:
            _save_json(_CACHE_FILE, cache_data)

    if not isinstance(cache_data, dict):
        _save_json(_BATCH_FILE, {"files": [], "first_edit_ts": None, "last_edit_ts": None})
        print(_APPROVE)
        return

    current_smells = cache_data.get("smells", [])
    if not isinstance(current_smells, list):
        current_smells = []

    # ------------------------------------------------------------------
    # 5. Load baseline
    # ------------------------------------------------------------------
    first_run = not _BASELINE_FILE.exists()
    baseline_data = _load_json(_BASELINE_FILE, {})
    baseline_smells = baseline_data.get("smells", []) if isinstance(baseline_data, dict) else []

    # ------------------------------------------------------------------
    # 6. Compute delta
    # ------------------------------------------------------------------
    edited_files = set(batch["files"])
    new_smells = _compute_delta(current_smells, baseline_smells, edited_files)
    new_smells = _filter_actionable_smells(new_smells, _PROJECT_PATH)

    # ------------------------------------------------------------------
    # 7. Update baseline and clear batch
    # ------------------------------------------------------------------
    _save_json(_BASELINE_FILE, {"smells": current_smells})
    _save_json(_BATCH_FILE, {"files": [], "first_edit_ts": None, "last_edit_ts": None})

    # ------------------------------------------------------------------
    # 8. Output feedback (skip on first run to avoid overwhelming)
    # ------------------------------------------------------------------
    if new_smells and not first_run:
        print(_format_delta(new_smells, len(edited_files)), file=sys.stderr)

    # ------------------------------------------------------------------
    # 8b. Security findings from cached scan (non-blocking)
    # ------------------------------------------------------------------
    try:
        _sec_cache = os.path.join(_PROJECT_PATH, ".jig", "security-scan.json")
        if os.path.exists(_sec_cache):
            with open(_sec_cache, "r") as _f:
                _scan = json.load(_f)
            _critical = _scan.get("criticalCount", 0)
            _high = _scan.get("highCount", 0)
            if _critical > 0 or _high > 0:
                _parts = []
                if _critical > 0:
                    _parts.append(f"{_critical} CRITICAL")
                if _high > 0:
                    _parts.append(f"{_high} high")
                print(
                    f"\U0001f512 Security: {', '.join(_parts)} findings (grade {_scan.get('riskGrade', '?')})"
                    " \u2014 use cube_get_findings() for details",
                    file=sys.stderr,
                )
    except Exception:
        pass

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(_APPROVE)
