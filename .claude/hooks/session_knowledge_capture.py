#!/usr/bin/env python3
"""Session Knowledge Capture — Stop hook.

Reads the session transcript and prints a brief summary before closing.
Reminds the agent to capture any unreferenced insights via memory_set.
Self-contained: no jig imports.

Protocol:
  stdin:  {"hook_event_name": "Stop", "session_id": "...", "transcript_path": "..."}
  stdout: summary block shown to Claude before session closes (or empty = silent)
  exit 0: always (never blocks session close)
  exit 2: would block — we never do this
"""
from __future__ import annotations

import json
import os
import signal
import sys
from pathlib import Path

MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024  # 10 MB guard


def _timeout_handler(signum: int, frame: object) -> None:
    sys.exit(0)


def _read_last_turns(transcript_path: str, n: int = 30) -> list[dict]:
    """Read last N entries from Claude Code transcript JSONL file."""
    path = Path(transcript_path)
    if not path.exists():
        return []
    try:
        if path.stat().st_size > MAX_TRANSCRIPT_BYTES:
            return []
        lines = path.read_text(encoding="utf-8").splitlines()
        turns: list[dict] = []
        for line in lines[-n:]:
            line = line.strip()
            if not line:
                continue
            try:
                turns.append(json.loads(line))
            except Exception:
                pass
        return turns
    except Exception:
        return []


def _count_memory_sets(turns: list[dict]) -> int:
    """Count memory_set tool calls in the turns."""
    count = 0
    for turn in turns:
        # Handle both message objects and JSONL attachment objects
        content = turn.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    name = block.get("name", "")
                    if "memory_set" in name:
                        count += 1
        # Also check tool_use at top level
        if turn.get("type") == "tool_use" and "memory_set" in turn.get("name", ""):
            count += 1
    return count


def _count_commits(turns: list[dict]) -> int:
    """Count git commit Bash tool calls in the turns."""
    count = 0
    for turn in turns:
        content = turn.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("name") == "Bash":
                    inp = block.get("input", {})
                    cmd = inp.get("command", "") if isinstance(inp, dict) else ""
                    if "git commit" in cmd:
                        count += 1
        # Top-level tool_use
        if turn.get("type") == "tool_use" and turn.get("name") == "Bash":
            inp = turn.get("input", {})
            cmd = inp.get("command", "") if isinstance(inp, dict) else ""
            if "git commit" in cmd:
                count += 1
    return count


def _read_next_task_exists(project_dir: str) -> bool:
    """Return True if a next_task entry exists for this project."""
    if not project_dir:
        return False
    project_name = Path(project_dir).name
    task_path = Path.home() / ".local" / "share" / "jig" / "next_task" / f"{project_name}.json"
    return task_path.exists()


def main() -> None:
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(10)

    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    transcript_path = payload.get("transcript_path", "")
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")

    turns = _read_last_turns(transcript_path)
    memory_count = _count_memory_sets(turns)
    commit_count = _count_commits(turns)
    has_next_task = _read_next_task_exists(project_dir)

    # Only print if there's something meaningful to report
    if memory_count == 0 and commit_count == 0 and not has_next_task:
        sys.exit(0)

    lines = ["## Session Summary\n"]
    if memory_count > 0:
        lines.append(f"{memory_count} {'memory' if memory_count == 1 else 'memories'} saved this session.")
    if commit_count > 0:
        lines.append(f"{commit_count} git {'commit' if commit_count == 1 else 'commits'} made.")
    if memory_count == 0 and commit_count > 0:
        lines.append("Consider: `memory_set` for any decisions or fixes not yet captured.")
    if has_next_task:
        lines.append("next_task is set — will inject context on next session start.")

    print("\n".join(lines))
    sys.exit(0)


if __name__ == "__main__":
    main()
