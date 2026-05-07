---
id: project_jig_memory_system
name: jig memory system — ~/.jig/memory/
description: jig has its own memory store at ~/.jig/memory/ separate from Claude Code's native ~/.claude/ memories, with TTL, priority, links, and tags.
type: project
tags:
  - jig
  - memory
  - memory_get
  - memory_set
  - memory_delete
links:
  - project_jig_resync
  - project_jig_obscura
priority: high
---

jig has its own user-level memory store at `~/.jig/memory/`, completely separate from Claude Code's native `~/.claude/projects/*/memory/`.

**Schema:** Each memory is a `.md` file with YAML frontmatter — fields: `id`, `name`, `description`, `type`, `tags`, `links`, `priority`, `ttl`.

**MCP tools (surface):**
- `memory_get(tags, top_n, expand_links)` — retrieves relevant memories; high-priority nodes always included; linked nodes expanded one level
- `memory_set(id, name, description, type, body, tags, links, priority, ttl)` — creates or updates a memory
- `memory_delete(id)` — removes a memory

**CLI:**
- `jig memory-gc` — dry-run; `jig memory-gc --apply` archives expired (TTL) files and rebuilds index; `jig memory-gc --stats` for metrics

**Why separate from ~/.claude/:** Claude Code's native memory loads everything flat with no filtering. jig's store adds scoring by relevance + recency, priority levels, link expansion, and TTL-based expiry.

**Engine:** `src/jig/engines/memory_store.py` — `load_all()`, `save()`, `query()`, `stats()`
**Tools:** `src/jig/tools/memory.py`
**GC CLI:** `src/jig/cli/memory_gc.py`
