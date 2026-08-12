# FlowTrace — Claude Code plugin

Packages FlowTrace for Claude Code: the trace-analysis MCP server, a skill for
reading traces, a read-only analyst subagent, and two slash commands.

## Install

```
/plugin marketplace add Rixmerz/flowtrace-debugger
/plugin install flowtrace@Rixmerz
```

## What it provides

| Component | Name | Purpose |
|-----------|------|---------|
| MCP server | `flowtrace` | `log.*` and `trace.*` tools over a `flowtrace.jsonl` |
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

## Build requirement

The bundled MCP server runs from `mcp-server/dist/server.js`, which is compiled
output. From the repo root:

```bash
make build-mcp
```

Shipping a prebuilt bundle so end users need no build step is still open —
`.gitignore` already reserves `mcp-server/dist/server.bundle.js` for it.
