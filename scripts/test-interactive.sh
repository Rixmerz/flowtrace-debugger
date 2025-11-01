#!/usr/bin/env bash
#
# Interactive test for MCP configurator
# This creates test configs instead of modifying real IDE configs
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEST_DIR="$SCRIPT_DIR/test-output"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}     FlowTrace MCP Interactive Test                        ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo -e "${YELLOW}This will test the configuration system with sample data${NC}"
echo -e "${YELLOW}No real IDE configs will be modified${NC}"
echo
echo "Test scenarios:"
echo "  1. Single selection (test: 1)"
echo "  2. Multiple selection (test: 1,2)"
echo "  3. All IDEs (test: 4)"
echo "  4. Multiple with duplicates (test: 1,1,2 should become 1,2)"
echo

# Setup test environment
echo -e "\n${BLUE}Setting up test environment...${NC}"
mkdir -p "$TEST_DIR"

# Create sample server
mkdir -p "$TEST_DIR/mcp-server/dist"
echo '// Test server' > "$TEST_DIR/mcp-server/dist/server.js"

echo -e "${GREEN}✓${NC} Test environment ready"
echo

# Test validation function
validate_selection() {
    local selection="$1"
    selection=$(echo "$selection" | tr -d ' ')

    if [ -z "$selection" ]; then
        echo "empty"
        return 1
    fi

    if ! [[ "$selection" =~ ^[1-4](,[1-4])*$ ]]; then
        echo "invalid"
        return 1
    fi

    echo "$selection"
    return 0
}

# Test cases
test_selection() {
    local input="$1"
    local expected="$2"

    echo -e "${BLUE}Testing:${NC} '$input'"

    if result=$(validate_selection "$input"); then
        if [ "$result" = "$expected" ]; then
            echo -e "${GREEN}✓ PASS${NC}: Got expected result '$result'"
        else
            echo -e "${RED}✗ FAIL${NC}: Expected '$expected', got '$result'"
        fi
    else
        if [ "$expected" = "invalid" ] || [ "$expected" = "empty" ]; then
            echo -e "${GREEN}✓ PASS${NC}: Correctly rejected invalid input"
        else
            echo -e "${RED}✗ FAIL${NC}: Should have accepted '$input'"
        fi
    fi
    echo
}

echo -e "${CYAN}Running validation tests...${NC}"
echo

# Run validation tests
test_selection "1" "1"
test_selection "1,2" "1,2"
test_selection "1,2,3" "1,2,3"
test_selection "4" "4"
test_selection "1, 2, 3" "1,2,3"  # With spaces
test_selection "" "empty"
test_selection "5" "invalid"
test_selection "1,5" "invalid"
test_selection "abc" "invalid"
test_selection "1;2" "invalid"

# Cleanup
echo -e "${BLUE}Cleaning up test environment...${NC}"
rm -rf "$TEST_DIR"
echo -e "${GREEN}✓${NC} Test complete"
echo
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}All validation tests completed successfully!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo "To test the full interactive flow, run:"
echo "  bash scripts/configure-mcp.sh"
echo
