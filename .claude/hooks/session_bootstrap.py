#!/usr/bin/env python3
"""Session Bootstrap — SessionStart hook.

Injects pending task context and DCC health warning at session open.
Self-contained: no jig imports.

Protocol:
  stdin:  {"session_id": "...", "hook_event_name": "SessionStart"}
  stdout: context block shown to Claude at session start
  stderr: warnings (DCC scope issues)
  exit 0: always
"""
from __future__ import annotations

import json
import os
import signal
import sqlite3
import sys
from pathlib import Path


def _timeout_handler(signum: int, frame: object) -> None:
    sys.exit(0)


def _read_next_task(project_dir: str) -> str | None:
    """Load next_task entry for this project and format it as markdown."""
    project_name = Path(project_dir).name
    task_path = Path.home() / ".local" / "share" / "jig" / "next_task" / f"{project_name}.json"
    if not task_path.exists():
        return None
    try:
        data = json.loads(task_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    task_desc = data.get("task_description", "")
    summary = data.get("summary", "")
    files = data.get("files_changed", [])
    saved_at = data.get("saved_at", "")
    if not task_desc and not summary:
        return None
    lines = ["### Pending Task"]
    if task_desc:
        lines.append(f"**Task:** {task_desc}")
    if summary:
        lines.append(f"**Summary:** {summary}")
    if files:
        files_str = ", ".join(files[:5])
        if len(files) > 5:
            files_str += f" (+{len(files) - 5} more)"
        lines.append(f"**Files touched:** {files_str}")
    if saved_at:
        lines.append(f"**Saved:** {saved_at}")
    return "\n".join(lines)


def _read_recent_experience(project_dir: str, n: int = 3) -> str | None:
    """Return a markdown block with top-n experience entries by occurrences."""
    project_name = Path(project_dir).name
    exp_path = (
        Path.home()
        / ".local"
        / "share"
        / "jig"
        / "project_memories"
        / project_name
        / "experience_memory.json"
    )
    if not exp_path.exists():
        return None
    try:
        data = json.loads(exp_path.read_text(encoding="utf-8"))
        entries = data.get("entries", [])
        if not entries:
            return None
        entries_sorted = sorted(entries, key=lambda e: e.get("occurrences", 0), reverse=True)
        top = entries_sorted[:n]
        lines = ["### Recent Experience"]
        for e in top:
            pattern = e.get("file_pattern", "?")
            etype = e.get("type", "?")
            resolution = (e.get("resolution") or "")[:80]
            occ = e.get("occurrences", 0)
            lines.append(f"- `{pattern}` ({etype}, ×{occ}): {resolution}")
        return "\n".join(lines)
    except Exception:
        return None


def _check_dcc_scope(project_dir: str) -> str | None:
    """Return warning string if dcc.db has no files from this project."""
    db_path = Path.home() / ".local" / "share" / "jig" / "dcc.db"
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None  # not indexed at all — doctor will catch this
    try:
        conn = sqlite3.connect(str(db_path), timeout=2)
        cur = conn.execute(
            "SELECT COUNT(*) FROM code_points WHERE file_path LIKE ? ESCAPE '\\'",
            (project_dir.rstrip("/") + "/%",),
        )
        count: int = cur.fetchone()[0]
        conn.close()
    except Exception:
        return None
    if count == 0:
        return (
            f"[DCC] dcc.db has data but 0 files from {Path(project_dir).name} — "
            "run cube_index_directory(path='src/') to index this project"
        )
    return None


def main() -> None:
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(5)

    try:
        json.load(sys.stdin)
    except Exception:
        pass

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        sys.exit(0)

    sections: list[str] = []

    next_task_block = _read_next_task(project_dir)
    if next_task_block:
        sections.append(next_task_block)

    try:
        experience_block = _read_recent_experience(project_dir)
        if experience_block:
            sections.append(experience_block)
    except Exception:
        pass

    dcc_warning = _check_dcc_scope(project_dir)
    if dcc_warning:
        print(dcc_warning, file=sys.stderr)

    if sections:
        print("## Session Context\n")
        print("\n\n".join(sections))

    sys.exit(0)


if __name__ == "__main__":
    main()
