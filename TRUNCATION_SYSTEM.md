# FlowTrace Truncation & Segmentation System

## Overview

The FlowTrace truncation system intelligently manages large log data by segmenting oversized fields into separate files while maintaining compact main logs with references to the complete data.

## Features

✅ **Dual Field Support**: Handles both `args` and `result` field truncation
✅ **Automatic Segmentation**: Large data automatically saved to separate files
✅ **Complete Data Preservation**: Full data always available in segmented files
✅ **Metadata Tracking**: Records original length and threshold information
✅ **Cross-Reference System**: Main logs contain references to full data files
✅ **Configurable Thresholds**: Customize truncation behavior per environment

## How It Works

### 1. Detection Phase
The system checks both `args` and `result` fields against the configured threshold (default: 1000 characters).

### 2. Segmentation Phase
When a field exceeds the threshold:
- **Full Log File**: Complete data saved to `flowtrace-jsonsl/flowtrace-{timestamp}-{event}.json`
- **Main Log Entry**: Truncated version with metadata and reference

### 3. Reference Phase
The main log entry contains:
- Truncated data with `...(truncated)` marker
- `truncatedFields` object with metadata
- `fullLogFile` path to complete data

## Architecture

```
Large Event Detected
        ↓
    [Field Check]
        ├─ args > threshold? → Truncate
        └─ result > threshold? → Truncate
        ↓
[Create Full Log File]
    flowtrace-jsonsl/flowtrace-{timestamp}-{event}.json
        ↓
[Create Truncated Main Log]
    {
      "args": "data...(truncated)",
      "result": "data...(truncated)",
      "truncatedFields": {
        "args": {"originalLength": 1500, "threshold": 1000},
        "result": {"originalLength": 5000, "threshold": 1000}
      },
      "fullLogFile": "flowtrace-jsonsl/flowtrace-1761859105788-EXIT.json"
    }
```

## Configuration

### Node.js

**Environment Variables:**
```bash
FLOWTRACE_TRUNCATE_THRESHOLD=1000        # Characters before truncation
FLOWTRACE_SEGMENT_DIRECTORY=flowtrace-jsonsl  # Directory for full logs
FLOWTRACE_ENABLE_SEGMENTATION=true       # Enable/disable feature
```

**System Properties:**
```bash
node --flowtrace.truncate-threshold=1000 \
     --flowtrace.segment-directory=flowtrace-jsonsl \
     --flowtrace.enable-segmentation=true \
     app.js
```

### Java

**System Properties:**
```bash
java -Dflowtrace.truncate-threshold=1000 \
     -Dflowtrace.segment-directory=flowtrace-jsonsl \
     -Dflowtrace.enable-segmentation=true \
     -jar app.jar
```

## Example Output

### Main Log (flowtrace.jsonl)
```json
{
  "timestamp": 1761859105788,
  "event": "EXIT",
  "thread": "main",
  "class": "TestClass",
  "method": "transformLargeData",
  "args": "[{\"id\":0,\"name\":\"Item 0\",\"description\":\"This is...(truncated)",
  "result": "[{\"id\":0,\"name\":\"Item 0\",\"transformed\":true...(truncated)",
  "truncatedFields": {
    "args": {
      "originalLength": 1004,
      "threshold": 1000
    },
    "result": {
      "originalLength": 4471,
      "threshold": 1000
    }
  },
  "fullLogFile": "flowtrace-jsonsl/flowtrace-1761859105788-EXIT.json",
  "durationMillis": 10
}
```

### Full Log (flowtrace-jsonsl/flowtrace-1761859105788-EXIT.json)
```json
{
  "timestamp": 1761859105788,
  "event": "EXIT",
  "thread": "main",
  "class": "TestClass",
  "method": "transformLargeData",
  "args": "[{\"id\":0,\"name\":\"Item 0\",\"description\":\"This is a detailed description...\"},...complete data...]",
  "result": "[{\"id\":0,\"name\":\"Item 0\",\"transformed\":true,\"extra\":\"...\"},...complete data...]",
  "durationMillis": 10
}
```

## Use Cases

### 1. Large API Responses
When methods return large JSON objects (e.g., database query results with hundreds of records):
- Main log: Truncated preview + metadata
- Full log: Complete response for debugging

### 2. Large Input Arguments
When methods receive large payloads (e.g., file uploads, batch operations):
- Main log: Truncated preview + metadata
- Full log: Complete input for analysis

### 3. Exception Messages
When exceptions contain large stack traces or data dumps:
- Main log: Summary with reference
- Full log: Complete exception details

## Testing

### Run Truncation Tests
```bash
cd examples
bash run-truncation-tests.sh
```

### Manual Test
```bash
# Node.js
FLOWTRACE_ENABLED=true \
FLOWTRACE_TRUNCATE_THRESHOLD=1000 \
FLOWTRACE_ENABLE_SEGMENTATION=true \
node examples/test-truncation-simple.js

# Java
java -Dflowtrace.enabled=true \
     -Dflowtrace.truncate-threshold=1000 \
     -Dflowtrace.enable-segmentation=true \
     -javaagent:flowtrace-agent/target/flowtrace-agent-1.0.0.jar \
     TestTruncation
```

### Verify Results
```bash
# Count main log entries
wc -l flowtrace.jsonl

# Count segmented files
ls -1 flowtrace-jsonsl/ | wc -l

# View truncated logs
grep "truncated" flowtrace.jsonl | jq

# View full logs
cat flowtrace-jsonsl/<filename> | jq
```

## Performance Impact

### Storage
- **Main Log**: Compact, fixed-size entries
- **Segmented Files**: Only created when needed
- **Overhead**: Minimal (JSON formatting only)

### Execution
- **Detection**: O(1) - simple length check
- **Truncation**: O(n) - substring operation
- **File Write**: O(1) - one-time operation
- **Total Impact**: < 1ms per large event

## MCP Server Integration

The MCP server automatically handles both truncated and full logs:

```javascript
// Query main logs (fast, compact)
const results = await logSearch(sessionId, {
  filter: "method == 'transformLargeData'"
});

// If truncated, read full log from segmented file
if (results[0].fullLogFile) {
  const fullData = fs.readFileSync(results[0].fullLogFile);
  console.log(JSON.parse(fullData));
}
```

## Migration from Old System

### Before (MAX_ARG_LENGTH)
- Only truncated `args` during serialization
- Used different marker: `...[truncated]`
- **No backup** - data was lost
- No metadata about truncation

### After (Segmentation System)
- Truncates both `args` and `result`
- Uses consistent marker: `...(truncated)`
- **Full backup** in segmented files
- Rich metadata (`truncatedFields`, `fullLogFile`)

### Backward Compatibility
Old logs with `...[truncated]` pattern will still be readable, but won't have full data backup.

## Best Practices

### 1. Set Appropriate Threshold
```bash
# Development: Higher threshold for debugging
FLOWTRACE_TRUNCATE_THRESHOLD=5000

# Production: Lower threshold for performance
FLOWTRACE_TRUNCATE_THRESHOLD=1000
```

### 2. Monitor Segmented Files
```bash
# Check segmented directory size
du -sh flowtrace-jsonsl/

# Clean old segmented files
find flowtrace-jsonsl/ -mtime +7 -delete
```

### 3. Disable for Small Projects
```bash
# If your data is always small
FLOWTRACE_ENABLE_SEGMENTATION=false
```

## Troubleshooting

### Issue: No segmented files created
**Check:**
- `FLOWTRACE_ENABLE_SEGMENTATION=true`
- Data actually exceeds threshold
- Write permissions for `flowtrace-jsonsl/` directory

### Issue: Segmented directory growing too large
**Solutions:**
- Lower threshold to reduce file count
- Implement log rotation
- Archive old segmented files

### Issue: Can't find full log file
**Check:**
- `fullLogFile` path in main log
- Segmented directory exists
- File permissions

## Future Enhancements

- [ ] Compression for segmented files (gzip)
- [ ] Automatic cleanup of old segmented files
- [ ] Configurable fields to truncate
- [ ] Streaming mode for extremely large data
- [ ] MCP server automatic full log retrieval

## Summary

The truncation and segmentation system provides the best of both worlds:
- **Fast main logs** for quick analysis and searching
- **Complete data preservation** for deep debugging
- **Flexible configuration** for different environments
- **Minimal performance impact** with automatic management

This solves the original problem where large exception messages and data were being lost due to truncation.
