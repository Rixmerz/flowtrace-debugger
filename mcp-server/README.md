# FlowTrace MCP Server

Generic MCP server for analyzing JSONL flow traces with AI-powered Root Cause Analysis (RCA).

## Overview

This MCP (Model Context Protocol) server provides tools to analyze execution flow traces in JSONL format, enabling AI assistants like Cursor and Claude to perform systematic root cause analysis.

## Installation

### Automated Installation

Run the installation script from the project root:

```bash
cd /path/to/flowtrace
./install-all.sh
```

This will:
1. Build the MCP server
2. Automatically configure Cursor integration (if Cursor is installed)
3. Create a backup of your existing Cursor configuration

### Manual Installation

If you need to install manually:

```bash
cd mcp-server
npm install
npm run build
```

Then configure Cursor manually using `cursor-mcp-config-example.json` as reference.

## Configuration

### Cursor Configuration

The MCP server configuration should be added to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/path/to/flowtrace/mcp-server/dist/server.js"],
      "cwd": "/path/to/flowtrace/mcp-server",
      "env": {}
    }
  }
}
```

**Note:** Replace `/path/to/flowtrace` with the actual absolute path to your FlowTrace installation.

### Claude Desktop Configuration

For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/path/to/flowtrace/mcp-server/dist/server.js"],
      "cwd": "/path/to/flowtrace/mcp-server",
      "env": {}
    }
  }
}
```

## Available Tools

### 1. `flowtrace_query`

Query and analyze JSONL flow trace files.

**Parameters:**
- `jsonlFile` (required): Path to the JSONL trace file
- `query` (required): Natural language query about the trace
- `maxLines` (optional): Maximum number of lines to analyze (default: 10000)

**Example:**
```typescript
flowtrace_query({
  jsonlFile: "./traces/app.jsonl",
  query: "Why are items not matching correctly?",
  maxLines: 5000
})
```

### 2. `flowtrace_aggregate`

Aggregate statistics from flow traces.

**Parameters:**
- `jsonlFile` (required): Path to the JSONL trace file
- `aggregationType` (required): Type of aggregation
  - `count` - Count occurrences
  - `sum` - Sum numeric values
  - `avg` - Calculate average
  - `min` - Find minimum
  - `max` - Find maximum
- `groupBy` (optional): Field to group by
- `filter` (optional): Filter expression

**Example:**
```typescript
flowtrace_aggregate({
  jsonlFile: "./traces/app.jsonl",
  aggregationType: "count",
  groupBy: "method"
})
```

### 3. `flowtrace_flow`

Analyze execution flow patterns.

**Parameters:**
- `jsonlFile` (required): Path to the JSONL trace file
- `startPattern` (optional): Pattern to identify flow start
- `endPattern` (optional): Pattern to identify flow end
- `maxDepth` (optional): Maximum depth for flow analysis

**Example:**
```typescript
flowtrace_flow({
  jsonlFile: "./traces/app.jsonl",
  startPattern: "processRequest",
  endPattern: "sendResponse",
  maxDepth: 10
})
```

## Root Cause Analysis Methodology

This MCP server is designed to work with a systematic RCA methodology documented in `cursor-rca-rules.md`.

### Key Principles

1. **Domain Classification**: Identify problem type before analysis
   - Domain A (Matching/Comparison)
   - Domain B (Behavior/Flow)

2. **Strict Analysis Order** (for Domain A):
   - First: Analyze comparison functions
   - Second: Analyze gates/filters
   - Third: Analyze assignments and loops

3. **Evidence-Based**: All conclusions must be supported by trace evidence

4. **Mandatory Response Format**: Structured output with executive summary

### Usage Example

```typescript
// Ask the AI assistant
"Using the FlowTrace MCP, analyze why items are not matching in app.jsonl"

// The AI will:
// 1. Load the trace using flowtrace_query
// 2. Apply RCA methodology from cursor-rca-rules.md
// 3. Provide structured analysis with evidence
```

## Files

- `server.ts` - Main MCP server implementation
- `lib/jsonl.ts` - JSONL parsing utilities
- `lib/query.ts` - Query execution engine
- `lib/agg.ts` - Aggregation functions
- `lib/flow.ts` - Flow analysis tools
- `cursor-rca-rules.md` - RCA methodology documentation
- `cursor-mcp-config-example.json` - Configuration example
- `MCP_TOOLS.md` - Detailed tool documentation

## Development

### Build

```bash
npm run build
```

### Run in Development Mode

```bash
npm run dev
```

### Test

```bash
npm test
```

## Troubleshooting

### MCP Server Not Available in Cursor

1. Check configuration file exists: `~/.cursor/mcp.json`
2. Verify server path is absolute (not relative)
3. Ensure server is built: `npm run build` in mcp-server directory
4. Restart Cursor after configuration changes

### Configuration Backup

The installation script creates a backup at `~/.cursor/mcp.json.backup` before modifying the configuration.

### Manual Configuration

If automatic configuration fails, manually copy the content from `cursor-mcp-config-example.json` and adjust the paths.

## Integration with FlowTrace

This MCP server is part of the FlowTrace project and integrates with:

- **FlowTrace Agent (Java)**: Generates JSONL traces from Java applications
- **FlowTrace Agent (JavaScript)**: Generates JSONL traces from Node.js applications
- **FlowTrace CLI**: Command-line interface for trace management

## License

MIT

## Documentation

- [Main FlowTrace Documentation](../README.md)
- [RCA Methodology](./cursor-rca-rules.md)
- [MCP Tools Reference](./MCP_TOOLS.md)
- [Java Usage Guide](../docs/USAGE_GUIDE.md)
- [JavaScript Usage Guide](../docs/USAGE_GUIDE_JS.md)
