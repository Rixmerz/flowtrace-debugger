#!/usr/bin/env bash
#
# Test Script for MCP Configurator
# Tests the multi-IDE configuration system
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_test() { echo -e "${BLUE}[TEST]${NC} $1"; }
print_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
print_fail() { echo -e "${RED}[FAIL]${NC} $1"; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DIR="$SCRIPT_DIR/test-configs"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    local test_command="$2"

    ((TESTS_RUN++))
    print_test "$test_name"

    if eval "$test_command"; then
        ((TESTS_PASSED++))
        print_pass "$test_name"
        return 0
    else
        ((TESTS_FAILED++))
        print_fail "$test_name"
        return 1
    fi
}

setup_test_env() {
    print_test "Setting up test environment..."

    # Create test directory
    mkdir -p "$TEST_DIR"

    # Create fake MCP server for testing
    mkdir -p "$TEST_DIR/mcp-server/dist"
    echo "// Fake server for testing" > "$TEST_DIR/mcp-server/dist/server.js"

    print_pass "Test environment ready"
}

cleanup_test_env() {
    print_test "Cleaning up test environment..."

    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
    fi

    print_pass "Test environment cleaned"
}

test_python_configurator_exists() {
    [ -f "$SCRIPT_DIR/mcp-configurator.py" ]
}

test_bash_configurator_exists() {
    [ -f "$SCRIPT_DIR/configure-mcp.sh" ] && [ -x "$SCRIPT_DIR/configure-mcp.sh" ]
}

test_python_configurator_syntax() {
    python3 -m py_compile "$SCRIPT_DIR/mcp-configurator.py" 2>/dev/null
}

test_templates_exist() {
    [ -f "$SCRIPT_DIR/ide-configs/cursor-template.json" ] && \
    [ -f "$SCRIPT_DIR/ide-configs/claude-template.json" ] && \
    [ -f "$SCRIPT_DIR/ide-configs/gemini-template.json" ]
}

test_templates_valid_json() {
    python3 - <<EOF
import json
import sys

templates = [
    "$SCRIPT_DIR/ide-configs/cursor-template.json",
    "$SCRIPT_DIR/ide-configs/claude-template.json",
    "$SCRIPT_DIR/ide-configs/gemini-template.json"
]

try:
    for template in templates:
        with open(template, 'r') as f:
            json.load(f)
    sys.exit(0)
except Exception as e:
    print(f"Invalid JSON: {e}", file=sys.stderr)
    sys.exit(1)
EOF
}

test_cursor_config_structure() {
    python3 - <<EOF
import json
import sys

try:
    with open("$SCRIPT_DIR/ide-configs/cursor-template.json", 'r') as f:
        config = json.load(f)

    # Check required structure
    assert "mcpServers" in config, "Missing mcpServers"
    assert "flowtrace" in config["mcpServers"], "Missing flowtrace entry"

    flowtrace = config["mcpServers"]["flowtrace"]
    assert "command" in flowtrace, "Missing command"
    assert "args" in flowtrace, "Missing args"
    assert "cwd" in flowtrace, "Missing cwd"
    assert "env" in flowtrace, "Missing env"

    sys.exit(0)
except Exception as e:
    print(f"Structure validation failed: {e}", file=sys.stderr)
    sys.exit(1)
EOF
}

test_gemini_config_structure() {
    python3 - <<EOF
import json
import sys

try:
    with open("$SCRIPT_DIR/ide-configs/gemini-template.json", 'r') as f:
        config = json.load(f)

    # Check required Gemini-specific structure
    assert "ide" in config, "Missing ide section"
    assert "hasSeenNudge" in config["ide"], "Missing ide.hasSeenNudge"
    assert "enabled" in config["ide"], "Missing ide.enabled"

    assert "mcpServers" in config, "Missing mcpServers"
    assert "flowtrace" in config["mcpServers"], "Missing flowtrace entry"

    flowtrace = config["mcpServers"]["flowtrace"]
    assert "command" in flowtrace, "Missing command"
    assert "args" in flowtrace, "Missing args"
    assert "env" in flowtrace, "Missing env"
    assert "cwd" not in flowtrace, "Gemini should NOT have cwd"

    assert "security" in config, "Missing security section"
    assert "auth" in config["security"], "Missing security.auth"

    sys.exit(0)
except Exception as e:
    print(f"Gemini structure validation failed: {e}", file=sys.stderr)
    sys.exit(1)
EOF
}

test_python_configurator_cursor() {
    local test_config="$TEST_DIR/test-cursor.json"

    # Run configurator
    python3 "$SCRIPT_DIR/mcp-configurator.py" cursor \
        "$TEST_DIR/mcp-server/dist/server.js" \
        "$TEST_DIR/mcp-server" 2>&1 | grep -q "configured successfully"

    # Check if config was created
    [ -f "$HOME/.cursor/mcp.json" ]
}

test_python_configurator_help() {
    python3 "$SCRIPT_DIR/mcp-configurator.py" 2>&1 | grep -q "Usage:"
}

# Run all tests
main() {
    echo
    echo "================================================"
    echo "  FlowTrace MCP Configurator Test Suite"
    echo "================================================"
    echo

    setup_test_env

    # File existence tests
    run_test "Python configurator exists" test_python_configurator_exists
    run_test "Bash configurator exists" test_bash_configurator_exists
    run_test "Python configurator syntax valid" test_python_configurator_syntax
    run_test "Templates exist" test_templates_exist

    # JSON validity tests
    run_test "Templates are valid JSON" test_templates_valid_json
    run_test "Cursor config structure valid" test_cursor_config_structure
    run_test "Gemini config structure valid" test_gemini_config_structure

    # Configurator functionality tests
    run_test "Python configurator shows help" test_python_configurator_help

    cleanup_test_env

    # Summary
    echo
    echo "================================================"
    echo "  Test Results"
    echo "================================================"
    echo -e "Total tests:  $TESTS_RUN"
    echo -e "Passed:       ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Failed:       ${RED}$TESTS_FAILED${NC}"
    echo "================================================"
    echo

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run tests
main "$@"
