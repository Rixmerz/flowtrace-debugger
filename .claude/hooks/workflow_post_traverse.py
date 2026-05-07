#!/usr/bin/env python3
"""Workflow Post-Traverse Hook — PostToolUse for graph_traverse.

Fires after every graph_traverse MCP call and records experience data from
DCC analysis into the project experience_memory.json file. The frontend
DCC reindex is triggered internally by WorkflowPanel polling (not this hook).

Protocol:
  stdin:  {"tool_name": "mcp__jig__graph_traverse", "tool_result": {...}}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}
  stderr: brief transition summary
  exit 0: always
"""

import json
import os
import subprocess
import sys
from pathlib import Path

_APPROVE = json.dumps({"decision": "approve"})


def _get_changed_files(project_path: str) -> list[str]:
    """Return list of files changed in the last commit (relative paths)."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
            capture_output=True, text=True, cwd=project_path, timeout=5
        )
        if result.returncode == 0:
            files = [f.strip() for f in result.stdout.splitlines() if f.strip()]
            return files
    except Exception:
        pass
    return []


def _record_experience(result: dict, project_path: str) -> None:
    """Persist experience entries from graph_traverse result using ExperienceMemoryStore."""
    from_node = result.get("from_node", "")
    to_node = result.get("to_node", "")
    edge_id = result.get("traversed_edge", "")
    reason = result.get("reason", "")
    dcc_analysis = result.get("dcc_analysis")
    impact = result.get("impact_preview", {})

    if not from_node and not to_node:
        return

    smells_summary = ""
    if isinstance(dcc_analysis, dict):
        smells_summary = dcc_analysis.get("smells", "")

    # Try to import experience_memory from jig
    wm_src = Path.home() / ".local" / "share" / "jig" / "src"
    # Also try project-local install
    proj_wm_src = Path(project_path) / ".jig" / "src"
    for src_path in [proj_wm_src, wm_src]:
        if src_path.exists() and str(src_path) not in sys.path:
            sys.path.insert(0, str(src_path))

    try:
        from workflow_manager.experience_memory import (
            ExperienceEntry, ExperienceMemoryStore,
            generalize_path, extract_file_keywords, guess_domain,
        )
    except ImportError:
        _record_experience_fallback(result, project_path,
                                     from_node, to_node, edge_id, reason,
                                     smells_summary, impact)
        return

    project_name = Path(project_path).name
    store = ExperienceMemoryStore()
    store.load(scope="project", project_name=project_name)

    changed_files = _get_changed_files(project_path)

    if changed_files:
        for rel_file in changed_files:
            entry_type = "smell_introduced" if smells_summary else ("impact_high" if impact else "tension_caused")
            description = f"{from_node} → {to_node}: {smells_summary[:120]}" if smells_summary else f"{from_node} → {to_node}"
            entry = ExperienceEntry(
                type=entry_type,
                file_pattern=generalize_path(rel_file),
                keywords=extract_file_keywords(rel_file),
                domain=guess_domain(rel_file),
                description=description,
                severity="medium",
                confidence=0.45,
                occurrences=1,
                project_origin=project_name,
                resolution=f"Edge: {edge_id}. Reason: {reason[:100]}",
                related_files=[rel_file],
                scope="project",
            )
            store.record(entry)
    else:
        # Fallback: one generic entry scoped to source files
        entry_type = "smell_introduced" if smells_summary else ("impact_high" if impact else "tension_caused")
        description = f"{from_node} → {to_node}: {smells_summary[:120]}" if smells_summary else f"{from_node} → {to_node}"
        entry = ExperienceEntry(
            type=entry_type,
            file_pattern="src/**/*.ts",
            keywords=[w for w in f"{from_node} {to_node}".replace("-", " ").split() if len(w) > 2],
            domain="general",
            description=description,
            severity="medium",
            confidence=0.30,
            occurrences=1,
            project_origin=project_name,
            resolution=f"Edge: {edge_id}. Reason: {reason[:100]}",
            scope="project",
        )
        store.record(entry)

    store.save()


def _record_experience_fallback(result: dict, project_path: str,
                                 from_node: str, to_node: str, edge_id: str,
                                 reason: str, smells_summary: str, impact: dict) -> None:
    """Fallback when experience_memory module is unavailable."""
    project_name = Path(project_path).name
    wm_dir = Path.home() / ".local" / "share" / "jig"
    proj_mem_dir = wm_dir / "project_memories" / project_name
    proj_mem_dir.mkdir(parents=True, exist_ok=True)
    mem_file = proj_mem_dir / "experience_memory.json"

    existing: dict = {"entries": []}
    if mem_file.exists():
        try:
            existing = json.loads(mem_file.read_text())
        except Exception:
            existing = {"entries": []}

    from datetime import datetime, timezone
    changed_files = _get_changed_files(project_path)
    file_pattern = f"src/**/*.ts" if not changed_files else changed_files[0]

    entry = {
        "type": "smell_introduced" if smells_summary else "impact_high",
        "file_pattern": file_pattern,
        "keywords": [w for w in f"{from_node} {to_node}".replace("-", " ").split() if len(w) > 2],
        "domain": "general",
        "description": f"{from_node} → {to_node}: {smells_summary[:120]}" if smells_summary else f"{from_node} → {to_node}",
        "severity": "medium",
        "confidence": 0.30,
        "occurrences": 1,
        "project_origin": project_name,
        "resolution": f"Edge: {edge_id}. Reason: {reason[:100]}",
        "scope": "project",
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "first_seen": datetime.now(timezone.utc).isoformat(),
    }

    entries: list = existing.get("entries", [])
    entries.append(entry)
    existing["entries"] = entries[-200:]

    try:
        mem_file.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
    except Exception:
        pass


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    if "graph_traverse" not in hook_input.get("tool_name", ""):
        print(_APPROVE)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(_APPROVE)
        return

    tool_result = hook_input.get("tool_result", {})
    if isinstance(tool_result, str):
        try:
            tool_result = json.loads(tool_result)
        except Exception:
            tool_result = {}

    from_node = tool_result.get("from_node", "")
    to_node = tool_result.get("to_node", "")

    try:
        _record_experience(tool_result, project_dir)
    except Exception:
        pass

    if from_node and to_node:
        print(f"⚡ {from_node} → {to_node} (experience recorded)", file=sys.stderr)

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(_APPROVE)
