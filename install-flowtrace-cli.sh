#!/usr/bin/env bash
#
# FlowTrace CLI Internal Installer
# For internal team use only
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
echo -e "${BLUE}        FlowTrace CLI Internal Installer                    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js not found. Please install Node.js >= 14.0.0"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    print_error "Node.js version too old. Required: >= 14.0.0, Found: $(node -v)"
    exit 1
fi

print_success "Node.js version: $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm not found"
    exit 1
fi

print_success "npm version: $(npm -v)"

# Detect installation method
echo
print_info "Select installation method:"
echo "  1. Install from local path (default)"
echo "  2. Install from Git repository"
echo "  3. Create symlink (npm link)"
echo
read -p "Choice [1-3]: " choice
choice=${choice:-1}

case $choice in
    1)
        print_info "Installing from local path..."

        # Default path (adjust for your team's setup)
        DEFAULT_PATH="/Users/juanpablodiaz/my_projects/flowtrace/flowtrace-cli"

        read -p "FlowTrace CLI path [$DEFAULT_PATH]: " CLI_PATH
        CLI_PATH=${CLI_PATH:-$DEFAULT_PATH}

        if [ ! -d "$CLI_PATH" ]; then
            print_error "Path not found: $CLI_PATH"
            exit 1
        fi

        print_info "Installing dependencies..."
        cd "$CLI_PATH"
        npm install

        print_info "Installing globally..."
        npm install -g "$CLI_PATH"

        print_success "Installation complete!"
        ;;

    2)
        print_info "Installing from Git repository..."

        read -p "Git repository URL: " GIT_URL

        if [ -z "$GIT_URL" ]; then
            print_error "Git URL required"
            exit 1
        fi

        print_info "Installing from Git..."
        npm install -g "$GIT_URL"

        print_success "Installation complete!"
        ;;

    3)
        print_info "Creating symlink (npm link)..."

        read -p "FlowTrace CLI path: " CLI_PATH

        if [ ! -d "$CLI_PATH" ]; then
            print_error "Path not found: $CLI_PATH"
            exit 1
        fi

        cd "$CLI_PATH"

        print_info "Installing dependencies..."
        npm install

        print_info "Creating global link..."
        npm link

        print_success "Symlink created!"
        ;;

    *)
        print_error "Invalid choice"
        exit 1
        ;;
esac

echo
print_info "Verifying installation..."

if command -v flowtrace &> /dev/null; then
    print_success "flowtrace command available"
    echo
    echo -e "${GREEN}✅ FlowTrace CLI installed successfully!${NC}"
    echo
    echo -e "${BLUE}Quick Start:${NC}"
    echo "  cd /path/to/your/project"
    echo "  flowtrace init"
    echo "  ./run-and-flowtrace.sh"
    echo
    echo -e "${BLUE}Help:${NC}"
    echo "  flowtrace --help"
    echo
else
    print_error "Installation failed. flowtrace command not found"
    exit 1
fi
