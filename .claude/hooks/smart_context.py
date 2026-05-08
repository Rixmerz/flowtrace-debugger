#!/usr/bin/env python3
"""Smart Context Injector — PreToolUse hook for Read/Edit/Write.

Injects project context at the right moment:
- First Read of session → project metadata (migrations, IDs, bounded contexts)
- First Write/Edit of session → relevant code patterns
- First Write to new directory → implementation checklist
- Every Edit of file with security findings → findings (10 min cooldown)

All data comes from pre-computed caches — no MCP calls, no subprocess, no Ollama.
Runs in <1s.

Protocol:
  stdin:  {"tool_name": "Edit", "tool_input": {"file_path": "..."}}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}  (never blocks)
  stderr: context injections (visible to agent)
  exit 0: always
"""

import json
import os
import sys
import time
from pathlib import Path

_APPROVE = json.dumps({"decision": "approve"})
_STATE_FILE = ".smart_context_state.json"
_SESSION_TIMEOUT = 1800  # 30 minutes = new session
_SECURITY_COOLDOWN = 600  # 10 minutes between security checks per file
_MAX_PATTERN_CHARS = 2000
_MAX_CHECKLIST_CHARS = 1500

# Extension → relevant pattern types
_EXT_PATTERN_MAP = {
    ".go": ["repository", "handler", "domain_entity", "migration"],
    ".ts": ["frontend_page", "frontend_hook", "frontend_service", "handler"],
    ".tsx": ["frontend_page", "frontend_hook", "frontend_service"],
    ".py": ["repository", "handler", "domain_entity"],
    ".rs": ["repository", "handler", "domain_entity"],
    ".java": ["repository", "handler", "domain_entity"],
    ".kt": ["repository", "handler", "domain_entity"],
}


def _get_file_path(hook_input: dict) -> str:
    tool_input = hook_input.get("tool_input", {})
    return tool_input.get("file_path", tool_input.get("path", ""))


def _find_state_dir(project_path: str) -> Path | None:
    """Find the centralized state directory for this project."""
    config_path = Path.home() / ".local" / "share" / "jig" / "jig-project.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            states_dir = config.get("states_dir", "states")
            project_name = Path(project_path).name
            state_dir = Path.home() / ".local" / "share" / "jig" / states_dir / project_name
            if state_dir.exists():
                return state_dir
        except Exception:
            pass
    local = Path(project_path) / ".claude" / "workflow"
    return local if local.exists() else None


def _load_state(project_path: str) -> dict:
    """Load hook state, resetting on new session."""
    state_path = Path(project_path) / ".claude" / "hooks" / _STATE_FILE
    state: dict = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            state = {}

    # Detect new session (state older than 30 min)
    last_activity = state.get("last_activity", 0)
    if time.time() - last_activity > _SESSION_TIMEOUT:
        # New session — reset per-session flags, keep security cooldowns
        security_checked = state.get("files_security_checked", {})
        state = {"files_security_checked": security_checked}

    state["last_activity"] = time.time()
    return state


def _save_state(project_path: str, state: dict) -> None:
    try:
        state_path = Path(project_path) / ".claude" / "hooks" / _STATE_FILE
        state_path.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def _inject_metadata(state_dir: Path) -> str | None:
    """Load project metadata and format for injection."""
    metadata_path = state_dir / "metadata.json"
    if not metadata_path.exists():
        return None
    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
        parts = ["📋 Project Context:"]

        mig = data.get("migration_number", {})
        if mig.get("last_number"):
            parts.append(f"  Migration: last={mig['last_number']}, next={mig['next_number']} (dir: {mig.get('directory', '?')})")

        ids = data.get("id_patterns", {})
        if ids.get("pattern"):
            examples = ", ".join(ids.get("examples", [])[:3])
            parts.append(f"  ID pattern: {ids['pattern']} ({examples})")
            if ids.get("note"):
                parts.append(f"  Note: {ids['note']}")

        bc = data.get("bounded_contexts", {})
        if bc.get("contexts"):
            parts.append(f"  Bounded contexts ({bc.get('count', '?')}): {', '.join(bc['contexts'][:10])}")

        ts = data.get("tech_stack", {})
        if ts.get("languages"):
            parts.append(f"  Stack: {', '.join(ts['languages'])}")

        return "\n".join(parts) if len(parts) > 1 else None
    except Exception:
        return None


def _inject_patterns(state_dir: Path, file_ext: str) -> str | None:
    """Load relevant patterns for the file extension."""
    patterns_path = state_dir / "patterns.json"
    if not patterns_path.exists():
        return None
    try:
        all_patterns = json.loads(patterns_path.read_text(encoding="utf-8"))
        relevant_types = _EXT_PATTERN_MAP.get(file_ext, [])

        if not relevant_types:
            return None

        parts = ["📐 Code Patterns (for reference):"]
        total_chars = 0
        for ptype in relevant_types:
            if ptype in all_patterns and isinstance(all_patterns[ptype], dict):
                p = all_patterns[ptype]
                snippet = p.get("snippet", "")
                lang = p.get("language", "")
                source = p.get("source_file", "")

                section = f"\n### {ptype} ({source})\n```{lang}\n{snippet}\n```"
                if total_chars + len(section) > _MAX_PATTERN_CHARS:
                    break
                parts.append(section)
                total_chars += len(section)

        return "\n".join(parts) if len(parts) > 1 else None
    except Exception:
        return None


def _inject_checklist(project_path: str) -> str | None:
    """Derive implementation checklist from experience memory."""
    wm_dir = Path.home() / ".local" / "share" / "jig"
    project_name = Path(project_path).name

    # Load experience entries
    entries: list[dict] = []
    for store_path in [
        wm_dir / "project_memories" / project_name / "experience_memory.json",
        wm_dir / "experience_memory.json",
    ]:
        if store_path.exists():
            try:
                data = json.loads(store_path.read_text(encoding="utf-8"))
                entries.extend(data.get("entries", []))
            except Exception:
                pass

    if len(entries) < 5:  # Not enough data
        return None

    # Group by generalized file pattern
    pattern_counts: dict[str, int] = {}
    pattern_examples: dict[str, list[str]] = {}
    for entry in entries:
        pattern = entry.get("file_pattern", "")
        if not pattern:
            continue
        occ = entry.get("occurrences", 1)
        pattern_counts[pattern] = pattern_counts.get(pattern, 0) + occ
        if pattern not in pattern_examples:
            pattern_examples[pattern] = []
        desc = entry.get("description", "")
        if desc and desc not in pattern_examples[pattern]:
            pattern_examples[pattern].append(desc)

    # Sort by count, take top items
    sorted_patterns = sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True)
    if not sorted_patterns:
        return None

    parts = ["📝 Implementation Checklist (from past experience):"]
    for pattern, count in sorted_patterns[:8]:
        if count < 2:
            break
        example = pattern_examples.get(pattern, [""])[0][:60]
        parts.append(f"  - [ ] `{pattern}` ({count}x) — {example}")

    result = "\n".join(parts)
    return result[:_MAX_CHECKLIST_CHARS] if len(parts) > 1 else None


def _inject_security(project_path: str, file_path: str) -> str | None:
    """Check cached security findings for this file."""
    cache_path = Path(project_path) / ".jig" / "security-scan.json"
    if not cache_path.exists():
        return None
    try:
        scan = json.loads(cache_path.read_text(encoding="utf-8"))
        critical = scan.get("criticalCount", 0)
        high = scan.get("highCount", 0)
        if critical == 0 and high == 0:
            return None

        grade = scan.get("riskGrade", "?")
        total = scan.get("findingsCount", 0)
        parts = []
        if critical > 0:
            parts.append(f"{critical} CRITICAL")
        if high > 0:
            parts.append(f"{high} high")

        return f"🔒 Security: {total} findings ({', '.join(parts)}, grade {grade}) — use cube_get_findings() for details"
    except Exception:
        return None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in ("Read", "Write", "Edit"):
        print(_APPROVE)
        return

    file_path = _get_file_path(hook_input)
    project_path = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_path:
        print(_APPROVE)
        return

    state = _load_state(project_path)
    state_dir = _find_state_dir(project_path)
    output_lines: list[str] = []

    # 1. First Read of session → project metadata
    if tool_name == "Read" and not state.get("metadata_injected") and state_dir:
        metadata = _inject_metadata(state_dir)
        if metadata:
            output_lines.append(metadata)
        state["metadata_injected"] = True

    # 2. First Write/Edit of session → patterns
    if tool_name in ("Write", "Edit") and not state.get("patterns_injected") and state_dir:
        ext = Path(file_path).suffix.lower() if file_path else ""
        patterns = _inject_patterns(state_dir, ext)
        if patterns:
            output_lines.append(patterns)
        state["patterns_injected"] = True

    # 3. First Write to new directory → checklist
    if tool_name == "Write" and file_path:
        dir_path = str(Path(file_path).parent)
        dirs_done = state.get("dirs_with_checklist", [])
        if dir_path not in dirs_done:
            checklist = _inject_checklist(project_path)
            if checklist:
                output_lines.append(checklist)
            dirs_done.append(dir_path)
            state["dirs_with_checklist"] = dirs_done

    # 4. Edit of file with security findings (10 min cooldown)
    if tool_name == "Edit" and file_path:
        sec_checked = state.get("files_security_checked", {})
        last_check = sec_checked.get(file_path, 0)
        if time.time() - last_check > _SECURITY_COOLDOWN:
            security = _inject_security(project_path, file_path)
            if security:
                output_lines.append(security)
            sec_checked[file_path] = time.time()
            state["files_security_checked"] = sec_checked

    # Output to stderr
    if output_lines:
        print("\n\n".join(output_lines), file=sys.stderr)

    _save_state(project_path, state)
    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(_APPROVE)
