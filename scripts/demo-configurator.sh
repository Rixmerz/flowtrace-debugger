#!/usr/bin/env bash
#
# Demo script for MCP configurator
# Shows how the interactive configurator would work
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}     FlowTrace MCP Configuration - Demo Mode              ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo -e "${YELLOW}This is a demonstration of the multi-IDE configurator${NC}"
echo
echo "To run the actual configurator with real IDE configs, use:"
echo -e "${GREEN}  bash scripts/configure-mcp.sh${NC}"
echo
echo "The configurator supports:"
echo "  1. Cursor       (~/.cursor/mcp.json)"
echo "  2. Claude Code  (~/Library/Application Support/Claude/claude_desktop_config.json)"
echo "  3. Gemini       (~/.gemini/settings.json)"
echo "  4. All          (Configure all 3 automatically)"
echo
echo "Examples:"
echo "  • Single:    1"
echo "  • Multiple:  1,2"
echo "  • All:       1,2,3  or  4"
echo
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo "Would you like to:"
echo "  [1] Run the actual configurator now"
echo "  [2] See the documentation"
echo "  [3] Exit"
echo
read -p "Your choice (1-3): " choice

case $choice in
    1)
        echo
        echo -e "${GREEN}Launching configurator...${NC}"
        bash "$SCRIPT_DIR/configure-mcp.sh"
        ;;
    2)
        echo
        echo -e "${GREEN}Opening documentation...${NC}"
        if [ -f "$SCRIPT_DIR/MULTI_IDE_SETUP.md" ]; then
            less "$SCRIPT_DIR/MULTI_IDE_SETUP.md"
        else
            echo "Documentation: $SCRIPT_DIR/MULTI_IDE_SETUP.md"
        fi
        ;;
    3)
        echo
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo
        echo "Invalid choice. Exiting..."
        exit 1
        ;;
esac
