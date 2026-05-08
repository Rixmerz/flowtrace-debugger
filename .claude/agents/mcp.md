---
name: mcp
description: MCP Management - read/write Model Context Protocol server configurations. Use proactively when the user needs to add, configure, list, or troubleshoot MCP server connections.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash
skills: csharp-patterns, debug, dev-patterns, devops-patterns, go-patterns, java-patterns, jig-methodology, jsbackend-patterns, py-patterns, qa-patterns, rs-patterns, testing, ts-patterns, ui-patterns, ux-patterns, validation
---
# MCP Agent

## Your Scope

You own the MCP (Model Context Protocol) server management - reading, writing, and injecting MCP server configurations for AI agents.

### Responsibilities
- MCP config reading/writing (`mcpService.ts`, `mcpConfigService.ts`)
- MCP manager UI (`McpManagerModal.tsx`, `McpIndicator.tsx`)
- MCP injection/removal before agent launch
- Cross-platform config path resolution
- Desktop vs Code MCP config sources

## Domain Structure

```
src/services/mcpService.ts           # Core MCP operations
src/services/mcpConfigService.ts     # Config file read/write
src/components/mcp/
├── McpManagerModal.tsx              # Full MCP server management UI
└── McpIndicator.tsx                 # Status indicator
src/agents/claude/components/
└── McpPanel.tsx                     # Claude-specific MCP panel (in plugin)
```

## Implementation Guidelines

### Config Sources
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `~/.config/Claude/claude_desktop_config.json` (Linux)
- **Claude Code**: `~/.claude.json`
- Both use `mcpServers` object with server name keys

### MCP Injection Flow
1. Before Claude launch, MCP commands are prepended to the CLI command
2. Remove: `claude mcp remove "<name>" 2>/dev/null || true`
3. Add: `claude mcp add-json "<name>" '<config>' -s user 2>/dev/null || true`
4. Commands chained with `;` before the `claude` launch command

### Cross-platform
- Home dir resolved via `src/services/homeDir.ts`
- Config paths differ between macOS and Linux

## Boundaries
- **Handles**: MCP config CRUD, injection commands, config path resolution
- **Delegates to @plugins**: Plugin-specific MCP panels
- **Delegates to @terminal**: Executing MCP commands via PTY


## Project Tech Stack

- **project**: flowtrace-debugger
- **type**: multi-language debugger + MCP server
- **agents**: {'java': 'flowtrace-agent (JVM bytecode instrumentation)', 'js': 'flowtrace-agent-js (Node)', 'python': 'agents/python', 'go': 'agents/go', 'rust': 'agents/rust', 'dotnet': 'agents/dotnet'}
- **frontend**: flowtrace-dashboard
- **mcp**: mcp-server (TypeScript SDK)
