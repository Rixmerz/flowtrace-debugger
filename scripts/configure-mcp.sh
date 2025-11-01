#!/usr/bin/env bash
#
# FlowTrace MCP Multi-IDE Configurator
# Configures FlowTrace MCP Server for multiple AI IDEs/Agents
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_header() { echo -e "${CYAN}$1${NC}"; }

# Default values
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MCP_SERVER_PATH="$PROJECT_ROOT/mcp-server/dist/server.js"

# IDE Config Paths
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
GEMINI_CONFIG="$HOME/.gemini/settings.json"

# Python configurator
PYTHON_CONFIGURATOR="$SCRIPT_DIR/mcp-configurator.py"

show_banner() {
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}     FlowTrace MCP Multi-IDE Configuration Tool            ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo
}

show_menu() {
    print_header "📦 Selecciona dónde configurar el MCP Server:"
    echo
    echo -e "  ${GREEN}1${NC}. Cursor"
    echo -e "  ${GREEN}2${NC}. Claude Code"
    echo -e "  ${GREEN}3${NC}. Gemini"
    echo -e "  ${GREEN}4${NC}. Todos los anteriores"
    echo
    echo -e "${YELLOW}Puedes seleccionar múltiples opciones separadas por comas${NC}"
    echo -e "${YELLOW}Ejemplo: 1,2,3 para configurar Cursor, Claude Code y Gemini${NC}"
    echo
}

validate_selection() {
    local selection="$1"

    # Remove spaces and validate format
    selection=$(echo "$selection" | tr -d ' ')

    # Check if empty
    if [ -z "$selection" ]; then
        return 1
    fi

    # Check if contains only numbers and commas
    if ! [[ "$selection" =~ ^[1-4](,[1-4])*$ ]]; then
        return 1
    fi

    echo "$selection"
    return 0
}

configure_cursor() {
    print_info "Configurando Cursor MCP..."

    if python3 "$PYTHON_CONFIGURATOR" cursor "$MCP_SERVER_PATH" "$PROJECT_ROOT/mcp-server"; then
        print_success "Cursor configurado correctamente"
        print_info "Config: $CURSOR_CONFIG"
        return 0
    else
        print_error "Error al configurar Cursor"
        return 1
    fi
}

configure_claude_code() {
    print_info "Configurando Claude Code MCP..."

    if python3 "$PYTHON_CONFIGURATOR" claude "$MCP_SERVER_PATH" "$PROJECT_ROOT/mcp-server"; then
        print_success "Claude Code configurado correctamente"
        print_info "Config: $CLAUDE_CONFIG"
        return 0
    else
        print_error "Error al configurar Claude Code"
        return 1
    fi
}

configure_gemini() {
    print_info "Configurando Gemini MCP..."

    if python3 "$PYTHON_CONFIGURATOR" gemini "$MCP_SERVER_PATH" "$PROJECT_ROOT/mcp-server"; then
        print_success "Gemini configurado correctamente"
        print_info "Config: $GEMINI_CONFIG"
        return 0
    else
        print_error "Error al configurar Gemini"
        return 1
    fi
}

process_selection() {
    local selection="$1"
    local ides=()
    local success_count=0
    local total_count=0

    # Convert comma-separated to array
    IFS=',' read -ra ides <<< "$selection"

    # Remove duplicates and sort
    ides=($(echo "${ides[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

    echo
    print_header "🔧 Iniciando configuración..."
    echo

    for ide in "${ides[@]}"; do
        ((total_count++))

        case "$ide" in
            1)
                if configure_cursor; then
                    ((success_count++))
                fi
                ;;
            2)
                if configure_claude_code; then
                    ((success_count++))
                fi
                ;;
            3)
                if configure_gemini; then
                    ((success_count++))
                fi
                ;;
            4)
                # Configure all
                if configure_cursor; then
                    ((success_count++))
                fi
                if configure_claude_code; then
                    ((success_count++))
                fi
                if configure_gemini; then
                    ((success_count++))
                fi
                ((total_count+=2))  # We configured 3 instead of 1
                ;;
        esac

        echo
    done

    # Summary
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    if [ $success_count -eq $total_count ]; then
        print_success "MCP configurado exitosamente en ${success_count}/${total_count} IDEs"
    else
        print_warning "MCP configurado en ${success_count}/${total_count} IDEs"
        print_info "Algunos IDEs fallaron. Ver mensajes arriba para detalles."
    fi
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo
}

main() {
    show_banner

    # Check if Python configurator exists
    if [ ! -f "$PYTHON_CONFIGURATOR" ]; then
        print_error "Python configurator not found: $PYTHON_CONFIGURATOR"
        print_info "Please ensure mcp-configurator.py exists in scripts/ directory"
        exit 1
    fi

    # Check if MCP server exists
    if [ ! -f "$MCP_SERVER_PATH" ]; then
        print_error "MCP server not found: $MCP_SERVER_PATH"
        print_info "Please run 'npm run build' in mcp-server/ directory first"
        exit 1
    fi

    # Check Python3
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is required but not found"
        print_info "Please install Python 3 to continue"
        exit 1
    fi

    show_menu

    # Get user selection
    local selection=""
    local valid_selection=""

    while true; do
        read -p "$(echo -e "${BLUE}Ingresa tu selección:${NC} ")" selection

        if valid_selection=$(validate_selection "$selection"); then
            break
        else
            print_error "Selección inválida. Por favor ingresa números del 1-4 separados por comas (ej: 1,2,3)"
        fi
    done

    process_selection "$valid_selection"

    # Additional information
    echo
    print_header "📚 Información Adicional:"
    echo "  • Los archivos de configuración originales fueron respaldados con extensión .backup"
    echo "  • Para revertir cambios, renombra los archivos .backup"
    echo "  • Reinicia tu IDE para que los cambios surtan efecto"
    echo
    print_info "Documentación: $PROJECT_ROOT/mcp-server/README.md"
    print_info "MCP Tools: $PROJECT_ROOT/mcp-server/MCP_TOOLS.md"
    echo
}

# Run main function
main "$@"
