---
id: project_jig_resync
name: jig resync — update assets without touching MCP config
description: jig resync updates hooks/rules/commands/workflows in an existing project from the installed version, without touching .mcp.json or settings.json.
type: project
tags:
  - jig
  - resync
  - init
  - update
  - hooks
  - rules
links:
  - project_jig_memory_system
priority: high
---

**CLI:** `jig resync <path> [--agents python fastmcp] [--dry-run]`

**MCP tool:** `jig_resync_project(project_path, tech_stack=None, dry_run=False)`

**What it updates:** hooks/, rules/ (base), commands/, workflows/
**What it does NOT touch:** .mcp.json, proxy.toml, settings.json (project-local config)

**When to use:**
- After `uv tool upgrade jig-mcp` — assets change with version
- When `.claude/rules/` or hooks are stale vs the installed jig version
- After `/clear` + reconnect in an existing project

**vs jig init:** `init` rewrites .mcp.json + migrates proxies. `resync` only refreshes assets.

**Files:** `src/jig/cli/resync_cmd.py`, `src/jig/tools/resync.py`

After resync, reconnect jig in Claude Code via `/mcp`.
