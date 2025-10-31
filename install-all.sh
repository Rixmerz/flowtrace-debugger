#!/usr/bin/env bash
#
# FlowTrace Complete Installation Script
# Instala Java agent, JavaScript agent y CLI
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           FlowTrace Complete Installation                 ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check prerequisites
print_info "Checking prerequisites..."

# Check Node.js for CLI
if ! command -v node &> /dev/null; then
    print_warning "Node.js not found. CLI installation will be skipped"
    SKIP_CLI=true
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 14 ]; then
        print_warning "Node.js version too old (need >= 14.0.0). CLI installation will be skipped"
        SKIP_CLI=true
    else
        print_success "Node.js: $(node -v)"
    fi
fi

# Check npm for CLI
if ! command -v npm &> /dev/null && [ -z "$SKIP_CLI" ]; then
    print_warning "npm not found. CLI installation will be skipped"
    SKIP_CLI=true
fi

# Check Maven for Java
if ! command -v mvn &> /dev/null; then
    print_warning "Maven not found. Java agent installation will be skipped"
    SKIP_JAVA=true
else
    print_success "Maven: $(mvn -v | head -1)"
fi

echo

# Install Java Agent
if [ -z "$SKIP_JAVA" ]; then
    print_info "Installing Java FlowTrace Agent..."

    cd "$SCRIPT_DIR/flowtrace-agent"

    print_info "Building Java agent..."
    mvn clean install -DskipTests

    if [ $? -eq 0 ]; then
        print_success "Java agent installed to ~/.m2/repository/"
        print_success "JAR available at: $SCRIPT_DIR/flowtrace-agent/target/flowtrace-agent-1.0.0.jar"
    else
        print_error "Java agent build failed"
    fi

    cd "$SCRIPT_DIR"
    echo
else
    print_warning "Skipping Java agent installation"
    echo
fi

# Install JavaScript Agent
print_info "JavaScript agent available at: $SCRIPT_DIR/flowtrace-agent-js/"
print_success "No build needed for JavaScript agent"
echo

# Install CLI
if [ -z "$SKIP_CLI" ]; then
    print_info "Installing FlowTrace CLI..."

    cd "$SCRIPT_DIR/flowtrace-cli"

    print_info "Installing CLI dependencies..."
    npm install

    print_info "Creating global link..."
    npm link

    if command -v flowtrace &> /dev/null; then
        print_success "FlowTrace CLI installed successfully!"
        print_success "Command 'flowtrace' is now available globally"
    else
        print_error "CLI installation failed"
    fi

    cd "$SCRIPT_DIR"
    echo
else
    print_warning "Skipping CLI installation (Node.js/npm not available)"
    echo
fi

# Install MCP Server
if [ -z "$SKIP_CLI" ]; then
    print_info "Installing FlowTrace MCP Server..."

    cd "$SCRIPT_DIR/mcp-server"

    print_info "Installing MCP server dependencies..."
    npm install

    print_info "Building MCP server..."
    npm run build

    if [ $? -eq 0 ]; then
        print_success "MCP server built successfully!"
        print_success "Server available at: $SCRIPT_DIR/mcp-server/dist/server.js"

        # Configure Cursor MCP
        CURSOR_MCP_CONFIG="$HOME/.cursor/mcp.json"

        if [ -f "$CURSOR_MCP_CONFIG" ]; then
            print_info "Configuring Cursor MCP integration..."

            # Backup existing config
            cp "$CURSOR_MCP_CONFIG" "$CURSOR_MCP_CONFIG.backup"
            print_info "Backup created at: $CURSOR_MCP_CONFIG.backup"

            # Check if flowtrace entry already exists
            if grep -q '"flowtrace"' "$CURSOR_MCP_CONFIG"; then
                print_warning "FlowTrace MCP already configured in Cursor"
            else
                # Use Python to safely merge JSON configurations
                python3 - <<EOF
import json
import sys

try:
    # Read existing config
    with open('$CURSOR_MCP_CONFIG', 'r') as f:
        config = json.load(f)

    # Ensure mcpServers exists
    if 'mcpServers' not in config:
        config['mcpServers'] = {}

    # Add flowtrace configuration
    config['mcpServers']['flowtrace'] = {
        'command': 'node',
        'args': ['$SCRIPT_DIR/mcp-server/dist/server.js'],
        'cwd': '$SCRIPT_DIR/mcp-server',
        'env': {}
    }

    # Write updated config
    with open('$CURSOR_MCP_CONFIG', 'w') as f:
        json.dump(config, f, indent=2)

    print('success')
except Exception as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
EOF
                if [ $? -eq 0 ]; then
                    print_success "FlowTrace MCP configured in Cursor!"
                    print_success "Config location: $CURSOR_MCP_CONFIG"
                else
                    print_error "Failed to configure Cursor MCP automatically"
                    print_info "Manual configuration required - see cursor-mcp-config-example.json"
                fi
            fi
        else
            print_warning "Cursor config not found at: $CURSOR_MCP_CONFIG"
            print_info "Manual configuration required - see cursor-mcp-config-example.json"
        fi
    else
        print_error "MCP server build failed"
    fi

    cd "$SCRIPT_DIR"
    echo
else
    print_warning "Skipping MCP server installation (Node.js/npm not available)"
    echo
fi

# Summary
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                 Installation Complete!                    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo

if [ -z "$SKIP_JAVA" ]; then
    echo -e "${BLUE}Java Agent:${NC}"
    echo "  ✓ Installed to: ~/.m2/repository/"
    echo "  ✓ JAR: $SCRIPT_DIR/flowtrace-agent/target/flowtrace-agent-1.0.0.jar"
    echo
fi

echo -e "${BLUE}JavaScript Agent:${NC}"
echo "  ✓ Available at: $SCRIPT_DIR/flowtrace-agent-js/"
echo

if [ -z "$SKIP_CLI" ]; then
    echo -e "${BLUE}FlowTrace CLI:${NC}"
    echo "  ✓ Command: flowtrace"
    echo "  ✓ Version: $(flowtrace --version 2>/dev/null || echo 'unknown')"
    echo

    echo -e "${BLUE}FlowTrace MCP Server:${NC}"
    echo "  ✓ Server: $SCRIPT_DIR/mcp-server/dist/server.js"
    if [ -f "$HOME/.cursor/mcp.json" ]; then
        if grep -q '"flowtrace"' "$HOME/.cursor/mcp.json"; then
            echo "  ✓ Cursor Integration: Configured"
        else
            echo "  ⚠ Cursor Integration: Manual configuration needed"
        fi
    else
        echo "  ⚠ Cursor Integration: Manual configuration needed"
    fi
    echo "  ✓ Documentation: $SCRIPT_DIR/mcp-server/cursor-rca-rules.md"
    echo "  ✓ Example Config: $SCRIPT_DIR/mcp-server/cursor-mcp-config-example.json"
    echo

    echo -e "${BLUE}Quick Start:${NC}"
    echo "  cd /path/to/your/project"
    echo "  flowtrace init"
    echo "  ./run-and-flowtrace.sh"
    echo
    echo -e "${BLUE}Cursor AI Usage:${NC}"
    echo "  1. Open Cursor"
    echo "  2. MCP server will be available if configured"
    echo "  3. Use RCA methodology from cursor-rca-rules.md"
    echo
else
    echo -e "${YELLOW}Note:${NC} CLI not installed. Install Node.js >= 14.0.0 and re-run this script"
    echo
    echo -e "${BLUE}Manual Usage (without CLI):${NC}"
    echo
    echo "  ${BLUE}For Java:${NC}"
    echo "    java -javaagent:$SCRIPT_DIR/flowtrace-agent/target/flowtrace-agent-1.0.0.jar \\"
    echo "         -Dflowtrace.package-prefix=com.yourapp \\"
    echo "         -jar your-app.jar"
    echo
    echo "  ${BLUE}For Node.js:${NC}"
    echo "    node --require $SCRIPT_DIR/flowtrace-agent-js/src/loader.js your-app.js"
    echo
fi

echo -e "${BLUE}Documentation:${NC}"
echo "  - Java:       $SCRIPT_DIR/docs/USAGE_GUIDE.md"
echo "  - JavaScript: $SCRIPT_DIR/docs/USAGE_GUIDE_JS.md"
echo "  - Examples:   $SCRIPT_DIR/examples/"
echo
