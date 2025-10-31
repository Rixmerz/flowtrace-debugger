#!/bin/bash

# Test script for truncation system
echo "======================================"
echo "FlowTrace Truncation System Tests"
echo "======================================"

# Clean up old logs
echo -e "\n[1/5] Cleaning old logs..."
rm -f flowtrace.jsonl
rm -rf flowtrace-jsonsl/
echo "✓ Cleaned"

# Test Node.js truncation
echo -e "\n[2/5] Testing Node.js truncation system..."
echo "Running test-truncation.js..."
cd "$(dirname "$0")/.."
FLOWTRACE_ENABLED=true \
FLOWTRACE_TRUNCATE_THRESHOLD=1000 \
FLOWTRACE_ENABLE_SEGMENTATION=true \
node --require ./flowtrace-agent-js/src/loader.js examples/test-truncation.js

echo -e "\n[3/5] Analyzing Node.js results..."
echo "Main log lines: $(wc -l < flowtrace.jsonl 2>/dev/null || echo 0)"
echo "Segmented files: $(ls -1 flowtrace-jsonsl/ 2>/dev/null | wc -l || echo 0)"

# Show sample truncated log
echo -e "\n[4/5] Sample truncated log (first occurrence):"
grep -m 1 "truncated" flowtrace.jsonl | jq -r 'select(.truncatedFields != null) | {event, method, truncatedFields, fullLogFile}' 2>/dev/null || echo "No truncated logs found"

# Show segmented file info
echo -e "\n[5/5] Segmented files created:"
ls -lh flowtrace-jsonsl/ 2>/dev/null || echo "No segmented files found"

echo -e "\n======================================"
echo "Tests completed!"
echo "======================================"
echo ""
echo "To inspect logs:"
echo "  - Main log: flowtrace.jsonl"
echo "  - Full logs: flowtrace-jsonsl/"
echo "  - View truncated: grep 'truncated' flowtrace.jsonl | jq"
echo "  - View full: cat flowtrace-jsonsl/<filename>"
echo ""
