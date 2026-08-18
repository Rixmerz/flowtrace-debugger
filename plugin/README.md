# FlowTrace — Claude Code plugin

Packages FlowTrace for Claude Code: the trace-analysis MCP server, a skill for
reading traces, a read-only analyst subagent, and two slash commands.

## Install

```
/plugin marketplace add Rixmerz/flowtrace-debugger
/plugin install flowtrace@rixmerz-flowtrace
```

## What it provides

| Component | Name | Purpose |
|-----------|------|---------|
| MCP server | `flowtrace` | `log_*` and `trace_*` tools over a `flowtrace.jsonl` |
| Skill | `flowtrace-analysis` | How to read a v2 trace — schema, tools, reading discipline |
| Subagent | `flowtrace-analyst` | Read-only trace investigation, returns findings not dumps |
| Command | `/flowtrace:trace` | Run a command under instrumentation |
| Command | `/flowtrace:analyze` | Answer a question from an existing trace |

## Plugin vs MCP server

These are not alternatives. The plugin is the distribution unit and it *ships*
the MCP server — `.mcp.json` here registers `mcp-server/` as one of its
components. Installing the plugin gets you the MCP tools plus the skill,
subagent and commands, which the MCP server alone could not provide: an MCP
server exposes tools, but it cannot teach a model when to reach for them or how
to read what comes back.

## No build step

Installing this plugin requires nothing but the copy. `.mcp.json` points at
`mcp/server.bundle.js` — a committed, single-file esbuild bundle with every
dependency inlined, so a bare `node` runs it with no `node_modules` present.

That is a deliberate constraint, not a convenience: a plugin install copies a
directory and never runs a build, so anything reached through `../`, left
gitignored, or still expecting its dependencies to be resolvable is simply
absent on the user's machine.

Contributors changing `mcp-server/src` must rebuild the bundle:

```bash
make bundle-mcp     # rebuild plugin/mcp/server.bundle.js
make check-bundle   # verify it is current and boots in an empty directory
```

CI runs `check-bundle` on every PR, so a stale bundle fails the build rather
than shipping.
