# IDE Configuration Templates

These templates show the expected structure for FlowTrace MCP configuration in each supported IDE.

## Supported IDEs

### 1. Cursor
- **Config Path**: `~/.cursor/mcp.json`
- **Template**: `cursor-template.json`
- **Structure**: Simple `mcpServers` object with `command`, `args`, `cwd`, and `env`

### 2. Claude Code
- **Config Path**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Template**: `claude-template.json`
- **Structure**: Same as Cursor

### 3. Gemini
- **Config Path**: `~/.gemini/settings.json`
- **Template**: `gemini-template.json`
- **Structure**: Includes additional `ide` and `security` sections
  - `ide.hasSeenNudge`: boolean
  - `ide.enabled`: boolean
  - `security.auth.selectedType`: string (gemini-api-key)
  - Note: Gemini config does NOT include `cwd` in mcpServers

## Usage

The templates are for reference only. The actual configuration is handled automatically by:
- `configure-mcp.sh` - Interactive TUI selector
- `mcp-configurator.py` - Python module for safe JSON merging

## Manual Configuration

If you prefer to configure manually:

1. Copy the appropriate template
2. Replace `/absolute/path/to/flowtrace/mcp-server/` with your actual FlowTrace installation path
3. Backup your existing IDE config (if any)
4. Merge the FlowTrace MCP server configuration into your IDE's config file

## Notes

- All paths must be absolute (no `~` or relative paths)
- The `env` object can contain environment variables if needed
- Gemini uses a different structure than Cursor/Claude - make sure to include the `ide` and `security` sections
- Always backup your config before manual modifications
