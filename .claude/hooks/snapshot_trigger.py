#!/usr/bin/env python3
"""PostToolUse hook: snapshot the workspace + inject a delta summary.

Fires after Bash/Edit/Write tool calls that touched the workspace. Uses
a lockfile throttle so bursts of edits don't flood the snapshot history.
When a snapshot is created, computes a lightweight delta (files changed
since the previous snapshot) and injects it back into Claude's context
via PostToolUse ``additionalContext``. A future version will also
consult DCC for smell/tension deltas on the changed set.

Protocol:

- stdin:  ``{"tool_name": ..., "tool_input": {...}, ...}``
- stdout: JSON hook response:
    ``{"hookSpecificOutput": {"hookEventName": "PostToolUse",
       "additionalContext": "<delta summary>"}}``
  Emitted only when a snapshot was actually created AND the delta is
  non-empty. Silent otherwise.
- stderr: brief advisory log.
- exit 0: always (never blocks).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

THROTTLE_SECONDS = 30.0
MAX_FILES_IN_SUMMARY = 15
_READ_ONLY_BASH = {
    "ls", "cat", "grep", "rg", "find", "pwd", "echo",
    "head", "tail", "wc", "git", "docker",
}


def _project_dir() -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.cwd()


def _read_input() -> dict:
    try:
        data = sys.stdin.read()
        if not data:
            return {}
        return json.loads(data)
    except Exception:
        return {}


def _should_skip(payload: dict) -> bool:
    tool = payload.get("tool_name", "")
    if tool in ("Edit", "Write"):
        return False
    if tool == "Bash":
        cmd = (payload.get("tool_input", {}) or {}).get("command", "")
        if not isinstance(cmd, str) or not cmd.strip():
            return True
        first = cmd.strip().split()[0]
        return first in _READ_ONLY_BASH
    return True


def _delta_summary(project: Path, previous_snap_sha: str | None) -> str | None:
    """One-block summary of files changed since the previous snapshot,
    optionally enriched with DCC smells that touch those files."""
    if not previous_snap_sha:
        return None
    try:
        result = subprocess.run(
            ["git", "diff", "--name-status", previous_snap_sha, "--", "."],
            capture_output=True, text=True, cwd=project, timeout=5,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
    if not lines:
        return None

    changed_files = []
    for ln in lines:
        parts = ln.split("\t", 1)
        if len(parts) == 2 and parts[1]:
            changed_files.append(parts[1])

    head = lines[:MAX_FILES_IN_SUMMARY]
    extra = len(lines) - len(head)
    body = "\n".join(f"  {ln}" for ln in head)
    tail = f"\n  … and {extra} more" if extra > 0 else ""
    summary = f"jig captured a snapshot. Files changed since previous snapshot:\n{body}{tail}"

    smells_block = _smell_block(changed_files)
    if smells_block:
        summary = f"{summary}\n\n{smells_block}"
    return summary


def _smell_block(files: list[str]) -> str | None:
    """If DCC is indexed, list up-to-5 ranked smells touching ``files``."""
    if not files:
        return None
    try:
        from jig.engines.dcc_glue import smells_for_files
    except Exception:
        return None
    try:
        hits = smells_for_files(files, max_results=5)
    except Exception:
        return None
    if not hits:
        return None
    lines = ["DCC smells in changed files:"]
    for h in hits:
        sev = h.get("severity", "?")
        name = h.get("smell_type") or h.get("type") or h.get("name") or "smell"
        fp = h.get("file_path") or h.get("file") or ""
        lines.append(f"  [{sev}] {name} — {fp}")
    return "\n".join(lines)


def _emit_context(text: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": text,
        }
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def main() -> int:
    payload = _read_input()
    if _should_skip(payload):
        return 0

    project = _project_dir()
    lock = project / ".jig" / "snapshots.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)

    now = time.time()
    if lock.exists():
        try:
            last = float(lock.read_text().strip())
            if now - last < THROTTLE_SECONDS:
                return 0
        except (ValueError, OSError):
            pass

    try:
        from jig.core import snapshots
    except Exception as e:
        print(f"[jig.snapshot] import failed: {e}", file=sys.stderr)
        return 0

    previous_head: str | None = None
    try:
        existing = snapshots.list_all(project)
        if existing:
            previous_head = existing[-1].commit
    except Exception:
        pass

    try:
        label = {"Edit": "edit-postrun", "Write": "write-postrun"}.get(
            payload.get("tool_name", ""), "bash-postrun"
        )
        snap = snapshots.create(project, label=label, phase="")
    except Exception as e:
        print(f"[jig.snapshot] skip: {e}", file=sys.stderr)
        return 0

    if snap is None:
        return 0

    lock.write_text(f"{now}", encoding="utf-8")
    print(f"[jig.snapshot] captured {snap.id}", file=sys.stderr)

    summary = _delta_summary(project, previous_head)
    if summary:
        _emit_context(summary)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
