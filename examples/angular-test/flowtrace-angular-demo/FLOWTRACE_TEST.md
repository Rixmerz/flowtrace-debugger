# FlowTrace Angular Test Demo

This Angular application demonstrates the FlowTrace truncation system with real-world scenarios involving large data operations.

## Features

- **Data Service**: Generates and processes large datasets
- **Truncation Testing**: All operations exceed the 1000-char threshold
- **Interactive UI**: Test different scenarios with buttons
- **Comprehensive Logging**: Captures args, results, and exceptions

## Test Scenarios

### Test 1: Generate Large Dataset
- Generates 100 users with detailed information
- **Expected**: Large `result` field will be truncated
- **Check**: `flowtrace.jsonl` for truncated result

### Test 2: Process Large Data
- Takes large input and produces large output
- **Expected**: Both `args` and `result` will be truncated
- **Check**: Both fields have `...(truncated)` marker

### Test 3: Async Operation
- Simulates API call with large response
- **Expected**: Async operation captured with truncation
- **Check**: Promise resolution with large data

### Test 4: Exception with Large Data
- Throws error with large context
- **Expected**: Exception args truncated but preserved
- **Check**: Full exception in segmented file

## Setup

### Prerequisites
- Node.js >= 14
- npm >= 6
- FlowTrace agent installed

### Installation

```bash
cd flowtrace/examples/angular-test/flowtrace-angular-demo
npm install
```

## Running Tests

### Option 1: With FlowTrace Instrumentation
```bash
./run-with-flowtrace.sh
```

This will:
1. Clean previous logs
2. Build the Angular app
3. Start dev server with FlowTrace agent
4. Open http://localhost:4200

### Option 2: Manual Configuration
```bash
# Set environment variables
export FLOWTRACE_ENABLED=true
export FLOWTRACE_PACKAGE_PREFIX="app"
export FLOWTRACE_TRUNCATE_THRESHOLD=1000
export FLOWTRACE_ENABLE_SEGMENTATION=true

# Run with FlowTrace
node --require ../../../flowtrace-agent-js/src/loader.js node_modules/.bin/ng serve
```

## Using the Demo

1. **Open Browser**: http://localhost:4200
2. **Run Tests**: Click individual test buttons or "Run All Tests"
3. **Check Console**: Browser console shows execution flow
4. **Inspect Logs**:
   - Main log: `flowtrace.jsonl`
   - Segmented files: `flowtrace-jsonsl/`

## Analyzing Results

### View Main Log (Truncated)
```bash
# Show all logs
cat flowtrace.jsonl | jq

# Find truncated entries
grep "truncated" flowtrace.jsonl | jq

# Count truncated logs
grep -c "truncatedFields" flowtrace.jsonl
```

### View Segmented Files (Complete Data)
```bash
# List segmented files
ls -lh flowtrace-jsonsl/

# View complete log
cat flowtrace-jsonsl/flowtrace-{timestamp}-{event}.json | jq

# Compare sizes
wc -c flowtrace.jsonl
du -sh flowtrace-jsonsl/
```

### Verify Truncation System
```bash
# Extract truncation metadata
cat flowtrace.jsonl | jq 'select(.truncatedFields != null) | {
  method,
  truncatedFields,
  fullLogFile
}'

# Verify full data is preserved
for file in flowtrace-jsonsl/*.json; do
  echo "File: $file"
  cat "$file" | jq '{method, args_length: (.args | tostring | length), result_length: (.result | tostring | length)}'
done
```

## Expected Output

### Main Log Example
```json
{
  "timestamp": 1761859105788,
  "event": "EXIT",
  "class": "DataService",
  "method": "processUsers",
  "args": "[{\"id\":0,\"name\":\"User 0 - Full Name...(truncated)",
  "result": "{\"processed\":[{\"id\":0,...(truncated)",
  "truncatedFields": {
    "args": {"originalLength": 5240, "threshold": 1000},
    "result": {"originalLength": 12360, "threshold": 1000}
  },
  "fullLogFile": "flowtrace-jsonsl/flowtrace-1761859105788-EXIT.json",
  "durationMillis": 15
}
```

### Segmented File Example
```json
{
  "timestamp": 1761859105788,
  "event": "EXIT",
  "class": "DataService",
  "method": "processUsers",
  "args": "[{\"id\":0,\"name\":\"User 0 - Full Name With Many Details\",...complete array...}]",
  "result": "{\"processed\":[{\"id\":0,...complete object...}],\"summary\":{...complete summary...}}",
  "durationMillis": 15
}
```

## Architecture

```
Angular App
    ↓
DataService (generates large data)
    ↓
FlowTrace Agent (instruments methods)
    ↓
Logger (checks truncation threshold)
    ↓
├─ Main Log: flowtrace.jsonl (truncated)
└─ Segmented: flowtrace-jsonsl/ (complete)
```

## Validation Checklist

- [ ] Main log file created (`flowtrace.jsonl`)
- [ ] Segmented directory created (`flowtrace-jsonsl/`)
- [ ] Truncated logs have `...(truncated)` marker
- [ ] Truncated logs have `truncatedFields` metadata
- [ ] Truncated logs have `fullLogFile` reference
- [ ] Segmented files contain complete data
- [ ] Segmented files are larger than truncated entries
- [ ] All test scenarios generate logs
- [ ] No data loss (all data in segmented files)

## Troubleshooting

### No logs generated
- Check FlowTrace is enabled: `FLOWTRACE_ENABLED=true`
- Check package prefix matches: `FLOWTRACE_PACKAGE_PREFIX="app"`
- Verify agent is loaded: Check console for "FlowTrace: Agent installed"

### No truncation occurring
- Check threshold: `FLOWTRACE_TRUNCATE_THRESHOLD=1000`
- Check segmentation enabled: `FLOWTRACE_ENABLE_SEGMENTATION=true`
- Verify data size: Ensure operations generate >1000 chars

### Segmented files not created
- Check directory permissions
- Verify `FLOWTRACE_SEGMENT_DIRECTORY` path
- Check disk space available

## Integration with MCP Server

### Start MCP Server
```bash
cd ../../../mcp-server
npm start
```

### Use Expansion Tools
```javascript
// Open log session
const session = await logOpen({path: "flowtrace.jsonl"});

// Find truncated logs
const truncated = await logSearch(session.sessionId, {
  filter: "processUsers"
});

// Expand specific log
const full = await logExpand(session.sessionId, {
  timestamp: truncated[0].timestamp,
  event: truncated[0].event
});

console.log("Complete data:", full.fullLog);
```

## Next Steps

1. **Customize Tests**: Modify `data.service.ts` for your scenarios
2. **Adjust Threshold**: Change `FLOWTRACE_TRUNCATE_THRESHOLD` value
3. **Add More Methods**: Create additional services to test
4. **Production Testing**: Test with real Angular applications
5. **MCP Integration**: Use MCP server for log analysis

## References

- [FlowTrace Documentation](../../../README.md)
- [Truncation System Guide](../../../TRUNCATION_SYSTEM.md)
- [MCP Server Tools](../../../mcp-server/MCP_TOOLS.md)
