#!/usr/bin/env python3
"""Memory Injector — PreToolUse hook for Edit/Write.

Automatically loads relevant .claude/memory/ markdown files when editing a file.
Self-contained (no external imports beyond stdlib).

Memory structure:
  .claude/memory/
    services/deltacodecubeService.md   → matches src/services/deltacodecubeService.ts
    services/dcc/_dccInternal.md       → matches src/services/dcc/_dccInternal.ts
    services/git/gitCore.md            → matches src/services/git/gitCore.ts
    plugins/types/plugin.md            → matches src/plugins/types/plugin.ts
    hooks/hooks-guide.md               → matches .claude/hooks/*.py

Protocol:
  stdin:  {"tool_name": "Edit", "tool_input": {"file_path": "..."}}
  stdout: {"decision": "approve"}   (never blocks)
  stderr: memory content (visible to agent as context)
  exit 0: always
"""

import json
import os
import sys
from pathlib import Path


_APPROVE = json.dumps({"decision": "approve"})

# Slow tools to skip memory injection (batch operations, not file-specific)
_SKIP_TOOLS = {"Bash", "Task", "Agent", "Read", "Glob", "Grep"}

# Generic stems that provide weak signal — lower threshold to 0.5 for these
_GENERIC_STEMS = frozenset({
    "index", "types", "handler", "utils", "helpers", "constants",
    "config", "main", "mod", "init", "base", "common", "shared",
})


def _get_file_path(hook_input: dict) -> str:
    """Extract file path from hook input or environment."""
    file_path = os.environ.get("FILE", "")
    if file_path:
        return file_path
    tool_input = hook_input.get("tool_input", {})
    return tool_input.get("file_path", tool_input.get("path", ""))


def _relative_to_project(file_path: str, project_dir: str) -> str:
    """Return path relative to project root, or absolute if not under project."""
    try:
        return str(Path(file_path).relative_to(project_dir))
    except ValueError:
        return file_path


def _find_memory_files(file_path: str, project_dir: str, memory_dir: Path) -> list[Path]:
    """Find memory files matching the edited file via path similarity scoring."""
    if not memory_dir.exists():
        return []

    rel_path = _relative_to_project(file_path, project_dir)
    target_stem = Path(file_path).stem.lower()
    target_parts = set(Path(rel_path).parts)

    # Collect all .md files under memory dir
    all_mds = list(memory_dir.rglob("*.md"))
    if not all_mds:
        return []

    scored: list[tuple[Path, float]] = []

    for md in all_mds:
        # Memory path relative to memory_dir (e.g. services/gitCore.md)
        mem_rel = md.relative_to(memory_dir)
        mem_parts = set(mem_rel.parts)
        mem_stem = md.stem.lower()

        score = 0.0

        # Exact stem match (highest signal)
        if mem_stem == target_stem:
            score += 3.0
        # Stem is contained in target (e.g. "gitCore" in "gitCore.ts")
        elif mem_stem in target_stem or target_stem in mem_stem:
            score += 1.5

        # Directory overlap (e.g. both in services/git/)
        common_parts = mem_parts & target_parts - {"src", ".", ""}
        score += len(common_parts) * 0.5

        # Parent directory match (e.g. memory is in services/dcc/ and file is in services/dcc/)
        target_parent = Path(rel_path).parent.name.lower()
        mem_parent = md.parent.name.lower()
        if target_parent and target_parent == mem_parent:
            score += 1.0

        # Generic guides (e.g. hooks-guide.md when editing .claude/hooks/)
        if "guide" in mem_stem or "index" in mem_stem:
            if common_parts:
                score += 0.5

        threshold = 0.5 if target_stem in _GENERIC_STEMS else 1.0
        if score >= threshold:
            scored.append((md, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    matches = [md for md, _ in scored[:2]]  # Max 2 memory files per edit

    # Fallback: if editing a .claude/hooks/*.py file and no matches found,
    # inject hooks-guide.md unconditionally (if it exists)
    if not matches and Path(file_path).suffix == ".py" and ".claude/hooks" in file_path.replace("\\", "/"):
        hooks_guide = memory_dir / "hooks" / "hooks-guide.md"
        if hooks_guide.exists():
            matches = [hooks_guide]

    return matches


def _format_memory(md_path: Path, memory_dir: Path) -> str:
    """Read and format a memory file for injection."""
    try:
        content = md_path.read_text(encoding="utf-8").strip()
        rel = md_path.relative_to(memory_dir)
        return f"--- MEMORY: {rel} ---\n{content}\n---"
    except Exception:
        return ""


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    tool_name = hook_input.get("tool_name", "")
    if tool_name in _SKIP_TOOLS:
        print(_APPROVE)
        return

    file_path = _get_file_path(hook_input)
    if not file_path:
        print(_APPROVE)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(_APPROVE)
        return

    memory_dir = Path(project_dir) / ".claude" / "memory"
    matching = _find_memory_files(file_path, project_dir, memory_dir)

    if matching:
        filename = Path(file_path).name
        blocks = []
        for md in matching:
            formatted = _format_memory(md, memory_dir)
            if formatted:
                blocks.append(formatted)

        if blocks:
            header = f"📚 Editing Memory ({len(blocks)} file{'s' if len(blocks) > 1 else ''} for {filename}):"
            print(header, file=sys.stderr)
            print("\n\n".join(blocks), file=sys.stderr)

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(_APPROVE)
