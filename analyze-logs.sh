#!/bin/bash

###############################################################################
# FlowTrace Log Analyzer
# Helps identify classes to exclude from instrumentation
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

LOG_FILE="${1:-flowtrace.log}"

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           FlowTrace Log Analyzer                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo -e "${RED}Error: Log file not found: $LOG_FILE${NC}"
    echo -e "${YELLOW}Usage: $0 [log-file]${NC}"
    echo -e "${YELLOW}Example: $0 flowtrace.log${NC}"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}"
    echo -e "${YELLOW}Install with: brew install jq (macOS) or apt-get install jq (Linux)${NC}"
    exit 1
fi

echo -e "${BLUE}📊 Analyzing log file: $LOG_FILE${NC}\n"

# Total log entries
total_entries=$(wc -l < "$LOG_FILE")
echo -e "${GREEN}✓ Total log entries: $total_entries${NC}"

# Unique classes
unique_classes=$(jq -r '.className' "$LOG_FILE" | sort -u | wc -l)
echo -e "${GREEN}✓ Unique classes: $unique_classes${NC}\n"

# Top 20 most common classes
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🔍 Top 20 Most Common Classes (Candidates for Exclusion)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

jq -r '.className' "$LOG_FILE" | sort | uniq -c | sort -rn | head -20 | \
    awk '{printf "  %5d  %s\n", $1, $2}'

echo ""

# Package prefixes analysis
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📦 Package Prefix Distribution${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

jq -r '.className' "$LOG_FILE" | \
    sed 's/\.[^.]*$//' | \
    sort | uniq -c | sort -rn | head -15 | \
    awk '{printf "  %5d  %s.*\n", $1, $2}'

echo ""

# Framework detection
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🔧 Framework Classes Detected${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Spring
spring_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^org\.springframework\." || echo "0")
if [ "$spring_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  Spring Framework: $spring_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"org.springframework.*\"))"
fi

# Hibernate
hibernate_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^org\.hibernate\." || echo "0")
if [ "$hibernate_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  Hibernate: $hibernate_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"org.hibernate.*\"))"
fi

# Jackson
jackson_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^com\.fasterxml\.jackson\." || echo "0")
if [ "$jackson_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  Jackson: $jackson_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"com.fasterxml.jackson.*\"))"
fi

# Logback
logback_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^ch\.qos\.logback\." || echo "0")
if [ "$logback_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  Logback: $logback_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"ch.qos.logback.*\"))"
fi

# HikariCP
hikari_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^com\.zaxxer\.hikari\." || echo "0")
if [ "$hikari_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  HikariCP: $hikari_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"com.zaxxer.hikari.*\"))"
fi

# MySQL
mysql_count=$(jq -r '.className' "$LOG_FILE" | grep -c "^com\.mysql\." || echo "0")
if [ "$mysql_count" -gt 0 ]; then
    echo -e "${RED}  ⚠️  MySQL Connector: $mysql_count classes${NC}"
    echo -e "      Suggested exclusion: .or(nameStartsWith(\"com.mysql.*\"))"
fi

echo ""

# Performance impact estimation
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📈 Performance Impact Estimation${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Calculate overhead based on class count
if [ "$unique_classes" -lt 100 ]; then
    overhead="1-3%"
    status="${GREEN}Optimal${NC}"
elif [ "$unique_classes" -lt 500 ]; then
    overhead="3-5%"
    status="${GREEN}Good${NC}"
elif [ "$unique_classes" -lt 1000 ]; then
    overhead="5-10%"
    status="${YELLOW}Moderate${NC}"
else
    overhead="10-20%"
    status="${RED}High - Consider more exclusions${NC}"
fi

echo -e "  Estimated overhead: $overhead"
echo -e "  Status: $status\n"

# Recommendations
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}💡 Recommendations${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

if [ "$unique_classes" -gt 500 ]; then
    echo -e "  ${RED}⚠️  High class count detected${NC}"
    echo -e "  1. Review top 20 classes and exclude framework internals"
    echo -e "  2. Use -Dflowtrace.package-prefix to filter your application package"
    echo -e "  3. See docs/CUSTOM_EXCLUSIONS.md for detailed guide"
else
    echo -e "  ${GREEN}✓ Class count is reasonable${NC}"
    echo -e "  Consider using package-prefix filter for further optimization"
fi

echo ""

# Quick command reference
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🔧 Useful Commands${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "  # List all unique classes"
echo -e "  ${GREEN}cat $LOG_FILE | jq -r '.className' | sort -u${NC}\n"

echo -e "  # Search for specific framework"
echo -e "  ${GREEN}cat $LOG_FILE | jq -r '.className' | grep -i 'spring'${NC}\n"

echo -e "  # Count methods by class"
echo -e "  ${GREEN}cat $LOG_FILE | jq -r '.className' | sort | uniq -c | sort -rn${NC}\n"

echo -e "  # Find slow methods (> 100ms)"
echo -e "  ${GREEN}cat $LOG_FILE | jq 'select(.durationMicros > 100000)'${NC}\n"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${GREEN}✅ Analysis complete${NC}\n"
echo -e "For detailed exclusion guide, see: ${BLUE}docs/CUSTOM_EXCLUSIONS.md${NC}\n"
