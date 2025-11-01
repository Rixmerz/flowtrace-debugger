#!/usr/bin/env python3
"""
FlowTrace MCP Configurator
Safely merges FlowTrace MCP configuration into IDE config files
Supports: Cursor, Claude Code, Gemini
"""

import json
import os
import sys
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional


class MCPConfigurator:
    """Handles MCP configuration for different IDEs"""

    # IDE Config Paths
    IDE_CONFIGS = {
        'cursor': Path.home() / '.cursor' / 'mcp.json',
        'claude': Path.home() / 'Library' / 'Application Support' / 'Claude' / 'claude_desktop_config.json',
        'gemini': Path.home() / '.gemini' / 'settings.json'
    }

    def __init__(self, ide: str, server_path: str, cwd_path: str):
        """
        Initialize configurator

        Args:
            ide: IDE name (cursor, claude, gemini)
            server_path: Absolute path to MCP server.js
            cwd_path: Working directory for MCP server
        """
        self.ide = ide.lower()
        self.server_path = os.path.abspath(server_path)
        self.cwd_path = os.path.abspath(cwd_path)

        if self.ide not in self.IDE_CONFIGS:
            raise ValueError(f"Unsupported IDE: {ide}. Choose from: {list(self.IDE_CONFIGS.keys())}")

        self.config_path = self.IDE_CONFIGS[self.ide]

    def read_config(self) -> Dict[str, Any]:
        """Read existing config or return empty structure"""
        if not self.config_path.exists():
            # Create parent directories if needed
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            return self._get_default_structure()

        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
                return config
        except json.JSONDecodeError as e:
            print(f"Warning: Invalid JSON in {self.config_path}: {e}", file=sys.stderr)
            print("Creating new configuration...", file=sys.stderr)
            return self._get_default_structure()
        except Exception as e:
            print(f"Error reading config: {e}", file=sys.stderr)
            raise

    def _get_default_structure(self) -> Dict[str, Any]:
        """Get default config structure for each IDE"""
        if self.ide == 'gemini':
            return {
                "ide": {
                    "hasSeenNudge": True,
                    "enabled": True
                },
                "mcpServers": {},
                "security": {
                    "auth": {
                        "selectedType": "gemini-api-key"
                    }
                }
            }
        else:
            # Cursor and Claude use simple structure
            return {
                "mcpServers": {}
            }

    def backup_config(self) -> Optional[Path]:
        """Create backup of existing config"""
        if not self.config_path.exists():
            return None

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = self.config_path.with_suffix(f'.backup.{timestamp}')

        try:
            shutil.copy2(self.config_path, backup_path)
            print(f"Backup created: {backup_path}")
            return backup_path
        except Exception as e:
            print(f"Warning: Could not create backup: {e}", file=sys.stderr)
            return None

    def get_flowtrace_config(self) -> Dict[str, Any]:
        """Get FlowTrace MCP configuration for this IDE"""
        base_config = {
            "command": "node",
            "args": [self.server_path]
        }

        if self.ide in ['cursor', 'claude']:
            # Cursor and Claude include 'cwd'
            base_config["cwd"] = self.cwd_path

        # All IDEs have env (even if empty)
        base_config["env"] = {}

        return base_config

    def merge_config(self, existing: Dict[str, Any]) -> Dict[str, Any]:
        """Merge FlowTrace config into existing config"""
        # Ensure mcpServers key exists
        if "mcpServers" not in existing:
            existing["mcpServers"] = {}

        # Check if flowtrace already configured
        if "flowtrace" in existing["mcpServers"]:
            print("Warning: FlowTrace MCP already configured. Updating...", file=sys.stderr)

        # Add/update flowtrace configuration
        existing["mcpServers"]["flowtrace"] = self.get_flowtrace_config()

        # For Gemini, ensure required structure exists
        if self.ide == 'gemini':
            if "ide" not in existing:
                existing["ide"] = {"hasSeenNudge": True, "enabled": True}
            if "security" not in existing:
                existing["security"] = {"auth": {"selectedType": "gemini-api-key"}}

        return existing

    def write_config(self, config: Dict[str, Any]) -> None:
        """Write config to file with pretty formatting"""
        try:
            with open(self.config_path, 'w') as f:
                json.dump(config, f, indent=2)
            print(f"Configuration written to: {self.config_path}")
        except Exception as e:
            print(f"Error writing config: {e}", file=sys.stderr)
            raise

    def configure(self) -> bool:
        """Main configuration process"""
        try:
            print(f"Configuring {self.ide.upper()}...")

            # Read existing config
            existing_config = self.read_config()

            # Backup
            self.backup_config()

            # Merge
            updated_config = self.merge_config(existing_config)

            # Write
            self.write_config(updated_config)

            print(f"✓ {self.ide.upper()} configured successfully")
            return True

        except Exception as e:
            print(f"✗ Failed to configure {self.ide.upper()}: {e}", file=sys.stderr)
            return False


def main():
    """CLI entry point"""
    if len(sys.argv) != 4:
        print("Usage: mcp-configurator.py <ide> <server_path> <cwd_path>", file=sys.stderr)
        print("  ide: cursor, claude, or gemini", file=sys.stderr)
        print("  server_path: absolute path to server.js", file=sys.stderr)
        print("  cwd_path: working directory for MCP server", file=sys.stderr)
        sys.exit(1)

    ide = sys.argv[1]
    server_path = sys.argv[2]
    cwd_path = sys.argv[3]

    # Validate server exists
    if not os.path.exists(server_path):
        print(f"Error: Server not found at {server_path}", file=sys.stderr)
        sys.exit(1)

    # Validate cwd exists
    if not os.path.exists(cwd_path):
        print(f"Error: Working directory not found at {cwd_path}", file=sys.stderr)
        sys.exit(1)

    try:
        configurator = MCPConfigurator(ide, server_path, cwd_path)
        success = configurator.configure()
        sys.exit(0 if success else 1)

    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
