#!/usr/bin/env python3
"""Graph Enforcer Hook — hard-blocks tools listed in current node's tools_blocked.

PreToolUse hook for Claude Code. Reads the active graph workflow state
(graph_state.json) and graph definition (graph.yaml) to enforce tool
restrictions per node. Fail-safe: approves on any error.

Replaces legacy workflow_enforcer.py which read steps.yaml/state.json.
"""

import json
import sys
import os
from pathlib import Path


def parse_tools_blocked(content):
    """Extract node_id -> tools_blocked mapping from graph YAML.

    Minimal parser (~25 lines). Only extracts 'id' and 'tools_blocked'
    fields from the nodes section. Stops at 'edges:' section.
    """
    mapping = {}
    node_id = None
    collecting = False

    for line in content.splitlines():
        stripped = line.strip()

        if not stripped or stripped.startswith("#"):
            continue

        # Stop at edges section — we only care about nodes
        if stripped == "edges:" or stripped == "edges":
            break

        # New node entry
        if stripped.startswith("- id:"):
            node_id = stripped.split(":", 1)[1].strip().strip('"').strip("'")
            mapping[node_id] = []
            collecting = False
            continue

        if node_id is None:
            continue

        # tools_blocked key (block list form)
        if stripped.startswith("tools_blocked:"):
            val = stripped.split(":", 1)[1].strip()
            if not val:  # List follows on next lines
                collecting = True
            continue

        # List item under tools_blocked
        if collecting and stripped.startswith("- "):
            mapping[node_id].append(stripped[2:].strip().strip('"').strip("'"))
            continue

        # Any other key ends tools_blocked collection
        if collecting and ":" in stripped:
            collecting = False

    return mapping


def get_state_path(project_dir):
    """Resolve graph_state.json path.

    Must stay in sync with ``engines.graph_state._get_centralized_state_dir``:
    state lives under XDG data at ``~/.local/share/jig/states/<project>/``
    regardless of whether ``~/.local/share/jig/config.json`` exists (the
    server writes there unconditionally). Fall back to the project-local
    ``.claude/workflow/graph_state.json`` for pre-XDG installs and manual
    setups.
    """
    project_name = Path(project_dir).name
    xdg_state = (
        Path.home() / ".local" / "share" / "jig" / "states"
        / project_name / "graph_state.json"
    )
    if xdg_state.exists():
        return xdg_state

    # Legacy hub override via explicit config.json (still honoured if present)
    config_file = Path.home() / ".local" / "share" / "jig" / "config.json"
    if config_file.exists():
        try:
            config = json.loads(config_file.read_text())
            hub_dir = config.get("hub_dir")
            if hub_dir:
                states_dir = config.get("states_dir", "states")
                override = Path(hub_dir) / states_dir / project_name / "graph_state.json"
                if override.exists():
                    return override
        except Exception:
            pass

    # Project-local fallback
    return Path(project_dir) / ".claude" / "workflow" / "graph_state.json"


# Tools that must ALWAYS pass the enforcer, no matter what the active
# graph YAML says. These are the recovery and inspection tools — if they
# could be blocked, a misconfigured workflow would lock the user out
# with no in-band way to disable the enforcer or reset state.
#
# Keep this list short and explicit. Read-only inspection + the enforcer
# toggle + graph reset. Nothing that mutates code or runs shell.
# Graph tools accessible via execute_mcp_tool that must always be approved
# (recovery + read-only inspection path). Bare names match tool_input.tool_name.
GRAPH_INNER_ALLOWLIST = frozenset({
    "graph_enforcer_toggle",
    "graph_status",
    "graph_reset",
    "graph_list_available",
    "graph_timeline",
})

ENFORCER_ALLOWLIST = frozenset({
    "mcp__jig__execute_mcp_tool",  # inner tool checked separately below
    "mcp__jig__jig_guide",
    "mcp__jig__jig_version",
})


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(json.dumps({"decision": "approve"}))
        return

    tool_name = hook_input.get("tool_name", "")

    # Hardcoded escape hatch: control + read-only graph tools always pass.
    # This is the in-band recovery path — without it, a stuck workflow
    # has no way back without editing files from a separate terminal.
    if tool_name in ENFORCER_ALLOWLIST:
        # execute_mcp_tool: check if inner graph tool is in recovery allowlist
        if tool_name == "mcp__jig__execute_mcp_tool":
            inner = hook_input.get("tool_input", {}).get("tool_name", "")
            if inner in GRAPH_INNER_ALLOWLIST:
                print(json.dumps({"decision": "approve"}))
                return
            # Fall through — inner tool subject to normal blocking below
        else:
            print(json.dumps({"decision": "approve"}))
            return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(json.dumps({"decision": "approve"}))
        return

    try:
        # 1. Read graph state (centralized hub or local)
        state_path = get_state_path(project_dir)
        if not state_path.exists():
            print(json.dumps({"decision": "approve"}))
            return

        state = json.loads(state_path.read_text())
        active_graph = state.get("active_graph")
        current_nodes = state.get("current_nodes", [])

        if not active_graph or not current_nodes:
            print(json.dumps({"decision": "approve"}))
            return

        # Check enforcer_enabled flag (written by the UI toggle)
        config_path = state_path.parent / "config.json"
        if config_path.exists():
            cfg = json.loads(config_path.read_text())
            if not cfg.get("enforcer_enabled", True):
                print(json.dumps({"decision": "approve"}))
                return

        current_node = current_nodes[0]

        # 2. Read graph YAML (always local to project)
        graph_file = Path(project_dir) / ".claude" / "workflow" / "graph.yaml"
        if not graph_file.exists():
            print(json.dumps({"decision": "approve"}))
            return

        blocked_map = parse_tools_blocked(graph_file.read_text())
        tools_blocked = blocked_map.get(current_node, [])

        # For execute_mcp_tool, check the inner tool name against blocked list
        effective = tool_name
        if tool_name == "mcp__jig__execute_mcp_tool":
            effective = hook_input.get("tool_input", {}).get("tool_name", tool_name)

        # 3. Check if tool is blocked ("*" = block everything)
        if "*" in tools_blocked or effective in tools_blocked:
            print(json.dumps({
                "decision": "block",
                "message": (
                    f"[Graph Enforcer] Tool '{effective}' is blocked at node "
                    f"'{current_node}' (workflow: {active_graph}). "
                    f"Advance the workflow with execute_mcp_tool(\"graph\", "
                    f"\"graph_traverse\", {{...}}) to use this tool. "
                    f"If the MCP server is unreachable and you cannot call "
                    f"graph_reset, run `jig graph reset --project "
                    f"{project_dir}` from a terminal to clear the state."
                )
            }))
            return

    except Exception:
        pass  # Fail-safe: approve on any error

    print(json.dumps({"decision": "approve"}))


if __name__ == "__main__":
    main()
