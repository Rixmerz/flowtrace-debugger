#!/bin/bash

################################################################################
# FlowTrace JavaScript/TypeScript Launcher
# Enhanced launcher with automatic detection and validation
# Equivalent to run-lleego.sh for Java
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

################################################################################
# Configuration
################################################################################

# Environment variable defaults
FLOWTRACE_PACKAGE_PREFIX="${FLOWTRACE_PACKAGE_PREFIX:-}"
FLOWTRACE_LOGFILE="${FLOWTRACE_LOGFILE:-flowtrace.jsonl}"
FLOWTRACE_STDOUT="${FLOWTRACE_STDOUT:-false}"
FLOWTRACE_ANNOTATION_ONLY="${FLOWTRACE_ANNOTATION_ONLY:-false}"
FLOWTRACE_ENABLED="${FLOWTRACE_ENABLED:-true}"

################################################################################
# Helper Functions
################################################################################

print_banner() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         FlowTrace JavaScript/TypeScript Launcher              ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo
}

print_error() {
    echo -e "${RED}✗ Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

################################################################################
# Auto-Detection Functions
################################################################################

detect_app_script() {
    local app_script=""

    # Priority 1: Explicit argument
    if [[ -n "$1" && -f "$1" ]]; then
        app_script="$1"
        print_success "Using explicit script: $app_script" >&2
        echo "$app_script"
        return 0
    fi

    # Priority 2: package.json "main" field
    if [[ -f "package.json" ]]; then
        local main_field=$(node -pe "try { require('./package.json').main } catch(e) { '' }" 2>/dev/null)
        if [[ -n "$main_field" && -f "$main_field" ]]; then
            app_script="$main_field"
            print_success "Detected from package.json: $app_script" >&2
            echo "$app_script"
            return 0
        fi
    fi

    # Priority 3: Common patterns
    for pattern in "src/index.js" "src/index.ts" "index.js" "index.ts" "app.js" "app.ts" "server.js" "server.ts" "src/main.js" "src/main.ts"; do
        if [[ -f "$pattern" ]]; then
            app_script="$pattern"
            print_success "Auto-detected script: $app_script" >&2
            echo "$app_script"
            return 0
        fi
    done

    # Not found
    print_error "No application script found"
    echo ""
    return 1
}

detect_agent_path() {
    local agent_path=""

    # Priority 1: Explicit environment variable
    if [[ -n "$FLOWTRACE_AGENT_PATH" && -d "$FLOWTRACE_AGENT_PATH" ]]; then
        agent_path="$FLOWTRACE_AGENT_PATH"
        print_success "Using explicit agent path: $agent_path" >&2
        echo "$agent_path"
        return 0
    fi

    # Priority 2: Local build
    if [[ -d "${SCRIPT_DIR}/flowtrace-agent-js" && -f "${SCRIPT_DIR}/flowtrace-agent-js/src/loader.js" ]]; then
        agent_path="${SCRIPT_DIR}/flowtrace-agent-js"
        print_success "Found local agent: $agent_path" >&2
        echo "$agent_path"
        return 0
    fi

    # Priority 3: Current directory
    if [[ -d "./flowtrace-agent-js" && -f "./flowtrace-agent-js/src/loader.js" ]]; then
        agent_path="./flowtrace-agent-js"
        print_success "Found agent in current directory: $agent_path" >&2
        echo "$agent_path"
        return 0
    fi

    # Priority 4: NPM global
    local npm_global=$(npm root -g 2>/dev/null)
    if [[ -n "$npm_global" && -d "$npm_global/flowtrace-agent-js" ]]; then
        agent_path="$npm_global/flowtrace-agent-js"
        print_success "Found global NPM agent: $agent_path" >&2
        echo "$agent_path"
        return 0
    fi

    # Priority 5: Local node_modules
    if [[ -d "./node_modules/flowtrace-agent-js" ]]; then
        agent_path="./node_modules/flowtrace-agent-js"
        print_success "Found agent in node_modules: $agent_path" >&2
        echo "$agent_path"
        return 0
    fi

    # Not found
    print_error "FlowTrace agent not found"
    echo ""
    return 1
}

detect_typescript() {
    local script="$1"

    # Check file extension
    if [[ "$script" =~ \.ts$ ]]; then
        print_info "TypeScript file detected"
        return 0
    fi

    # Check for tsconfig.json
    if [[ -f "tsconfig.json" ]]; then
        print_info "TypeScript project detected (tsconfig.json found)"
        return 0
    fi

    return 1
}

detect_esm() {
    local script="$1"

    # Check file extension
    if [[ "$script" =~ \.mjs$ ]]; then
        print_info "ES Module file detected (.mjs)"
        return 0
    fi

    # Check package.json type
    if [[ -f "package.json" ]]; then
        local pkg_type=$(node -pe "try { require('./package.json').type } catch(e) { '' }" 2>/dev/null)
        if [[ "$pkg_type" == "module" ]]; then
            print_info "ES Module project detected (package.json type: module)"
            return 0
        fi
    fi

    return 1
}

################################################################################
# Pre-Flight Checks
################################################################################

check_node_version() {
    print_info "Checking Node.js version..."

    if ! command -v node &> /dev/null; then
        print_error "Node.js not found. Please install Node.js."
        exit 1
    fi

    local node_version=$(node -v | sed 's/v//')
    local major_version=$(echo "$node_version" | cut -d. -f1)

    if [[ "$major_version" -lt 16 ]]; then
        print_error "Node.js version 16 or higher required (found: v$node_version)"
        exit 1
    fi

    print_success "Node.js version: v$node_version"
}

check_disk_space() {
    print_info "Checking disk space..."

    local available_mb=$(df -m . | awk 'NR==2 {print $4}')

    if [[ "$available_mb" -lt 100 ]]; then
        print_warning "Low disk space: ${available_mb}MB available"
    else
        print_success "Disk space available: ${available_mb}MB"
    fi
}

check_permissions() {
    print_info "Checking file permissions..."

    if [[ ! -w "." ]]; then
        print_error "No write permission in current directory"
        exit 1
    fi

    print_success "File permissions OK"
}

run_preflight_checks() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Pre-Flight Checks${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    check_node_version
    check_disk_space
    check_permissions

    echo
}

################################################################################
# Configuration Display
################################################################################

display_configuration() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Configuration${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Application Script:${NC}    $APP_SCRIPT"
    echo -e "${GREEN}Agent Path:${NC}            $AGENT_PATH"
    echo -e "${GREEN}Package Prefix:${NC}        ${FLOWTRACE_PACKAGE_PREFIX:-(none - all packages)}"
    echo -e "${GREEN}Log File:${NC}              $FLOWTRACE_LOGFILE"
    echo -e "${GREEN}Console Output:${NC}        $FLOWTRACE_STDOUT"
    echo -e "${GREEN}Annotation Only:${NC}       $FLOWTRACE_ANNOTATION_ONLY"
    echo -e "${GREEN}TypeScript Support:${NC}    $TYPESCRIPT_MODE"
    echo -e "${GREEN}Module Type:${NC}           $MODULE_TYPE"
    echo
}

################################################################################
# Main Execution
################################################################################

main() {
    print_banner

    # Auto-detect application script
    APP_SCRIPT=$(detect_app_script "$1")
    if [[ -z "$APP_SCRIPT" ]]; then
        print_error "Usage: $0 [script.js|script.ts]"
        print_info "Or ensure package.json has 'main' field, or have index.js/app.js in project root"
        exit 1
    fi

    # Auto-detect agent
    AGENT_PATH=$(detect_agent_path)
    if [[ -z "$AGENT_PATH" ]]; then
        print_error "Please install flowtrace-agent-js or set FLOWTRACE_AGENT_PATH"
        exit 1
    fi

    # Detect TypeScript
    if detect_typescript "$APP_SCRIPT"; then
        TYPESCRIPT_MODE="enabled"

        # Check if ts-node is available
        if ! npm list ts-node &>/dev/null && ! npm list -g ts-node &>/dev/null; then
            print_warning "TypeScript detected but ts-node not found. Installing ts-node..."
            npm install --no-save ts-node @types/node || {
                print_error "Failed to install ts-node. Please install manually: npm install -D ts-node @types/node"
                exit 1
            }
        fi
    else
        TYPESCRIPT_MODE="disabled"
    fi

    # Detect module type
    if detect_esm "$APP_SCRIPT"; then
        MODULE_TYPE="ES Module"
        USE_ESM_LOADER=true
    else
        MODULE_TYPE="CommonJS"
        USE_ESM_LOADER=false
    fi

    # Run pre-flight checks
    run_preflight_checks

    # Display configuration
    display_configuration

    # Export environment variables
    export FLOWTRACE_PACKAGE_PREFIX
    export FLOWTRACE_LOGFILE
    export FLOWTRACE_STDOUT
    export FLOWTRACE_ANNOTATION_ONLY
    export FLOWTRACE_ENABLED

    # Build Node.js execution command
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Starting Application with FlowTrace${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    if [[ "$USE_ESM_LOADER" == true ]]; then
        # ES Module mode
        print_info "Launching with ESM loader..."
        exec node --loader "${AGENT_PATH}/src/esm-loader.mjs" "$APP_SCRIPT" "${@:2}"
    else
        # CommonJS mode
        print_info "Launching with require hook..."
        exec node --require "${AGENT_PATH}/src/loader.js" "$APP_SCRIPT" "${@:2}"
    fi
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${YELLOW}FlowTrace terminated by user${NC}"; exit 130' INT

# Run main
main "$@"
