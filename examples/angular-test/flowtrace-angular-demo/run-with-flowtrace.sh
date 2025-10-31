#!/bin/bash

echo "======================================"
echo "FlowTrace Angular Demo"
echo "======================================"
echo ""

# Setup paths
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
FLOWTRACE_AGENT="$SCRIPT_DIR/../../../flowtrace-agent-js"

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
echo "  Package Prefix: app (Angular app namespace)"
echo "  Truncate Threshold: 1000 chars"
echo "  Enable Segmentation: true"
echo "  Segment Directory: flowtrace-jsonsl"
echo ""

# Build Angular app
echo "Building Angular application..."
npm run build -- --configuration development 2>&1 | tail -10
echo ""

if [ ! -d "dist" ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✓ Build completed"
echo ""

# Serve with FlowTrace instrumentation
echo "Starting development server with FlowTrace..."
echo ""
echo "📊 FlowTrace will capture:"
echo "  - Function calls in app/* namespace"
echo "  - Large data operations (>1000 chars)"
echo "  - Async operations"
echo "  - Exception handling"
echo ""
echo "🌐 Open browser: http://localhost:4200"
echo "🧪 Click buttons to test truncation"
echo "📝 Check flowtrace.jsonl and flowtrace-jsonsl/ for logs"
echo ""
echo "Press Ctrl+C to stop"
echo "======================================"
echo ""

# Run with FlowTrace
FLOWTRACE_ENABLED=true \
FLOWTRACE_PACKAGE_PREFIX="app" \
FLOWTRACE_TRUNCATE_THRESHOLD=1000 \
FLOWTRACE_ENABLE_SEGMENTATION=true \
FLOWTRACE_SEGMENT_DIRECTORY="flowtrace-jsonsl" \
FLOWTRACE_STDOUT=false \
node --require "$FLOWTRACE_AGENT/src/loader.js" node_modules/.bin/ng serve
