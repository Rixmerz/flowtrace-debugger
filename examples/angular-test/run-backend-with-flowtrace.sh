#!/bin/bash

echo "======================================"
echo "FlowTrace Backend API Test"
echo "======================================"
echo ""

# Setup paths
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
FLOWTRACE_AGENT="$SCRIPT_DIR/../../flowtrace-agent-js"

# Check if FlowTrace agent exists
if [ ! -d "$FLOWTRACE_AGENT" ]; then
    echo "❌ FlowTrace agent not found at: $FLOWTRACE_AGENT"
    exit 1
fi

echo "✓ FlowTrace agent found"
echo ""

# Clean previous logs
echo "Cleaning previous logs..."
rm -f flowtrace.jsonl
rm -rf flowtrace-jsonsl/
echo "✓ Logs cleaned"
echo ""

# Configuration
echo "FlowTrace Configuration:"
echo "  Enabled: true"
echo "  Truncate Threshold: 1000 chars"
echo "  Enable Segmentation: true"
echo "  Segment Directory: flowtrace-jsonsl"
echo ""

echo "Starting backend API with FlowTrace..."
echo ""
echo "📊 FlowTrace will capture:"
echo "  - API endpoint calls"
echo "  - Large data operations (>1000 chars)"
echo "  - Async operations"
echo "  - Exception handling"
echo ""
echo "🌐 Server will run on: http://localhost:3001"
echo "🧪 Use curl or Angular app to test"
echo "📝 Check flowtrace.jsonl and flowtrace-jsonsl/ for logs"
echo ""
echo "Press Ctrl+C to stop"
echo "======================================"
echo ""

# Run with FlowTrace
# Note: No package prefix means it will instrument the backend-api.js functions
# but we need to be careful not to instrument Node.js internals
FLOWTRACE_ENABLED=true \
FLOWTRACE_PACKAGE_PREFIX="" \
FLOWTRACE_TRUNCATE_THRESHOLD=1000 \
FLOWTRACE_ENABLE_SEGMENTATION=true \
FLOWTRACE_SEGMENT_DIRECTORY="flowtrace-jsonsl" \
FLOWTRACE_STDOUT=false \
FLOWTRACE_ANNOTATION_ONLY=false \
node --require "$FLOWTRACE_AGENT/src/loader.js" backend-api.js
