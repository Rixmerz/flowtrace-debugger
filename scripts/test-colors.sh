#!/usr/bin/env bash
#
# Test color display for MCP configurator
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}     FlowTrace MCP Multi-IDE Configuration Tool            ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo -e "${CYAN}📦 Selecciona dónde configurar el MCP Server:${NC}"
echo
echo -e "  ${GREEN}1${NC}. Cursor"
echo -e "  ${GREEN}2${NC}. Claude Code"
echo -e "  ${GREEN}3${NC}. Gemini"
echo -e "  ${GREEN}4${NC}. Todos los anteriores"
echo
echo -e "${YELLOW}Puedes seleccionar múltiples opciones separadas por comas${NC}"
echo -e "${YELLOW}Ejemplo: 1,2,3 para configurar Cursor, Claude Code y Gemini${NC}"
echo
