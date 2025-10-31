# Flowtrace MCP Server - Tool Reference

## Server Configuration
- **Name**: flowtrace-mcp
- **Version**: 0.1.0
- **Transport**: stdio
- **Build Status**: ✅ Successful

## New Features
- ✅ **Truncated Log Expansion**: Automatically retrieve full data from segmented files
- ✅ **Auto-Expand Mode**: Search with automatic expansion of truncated entries
- ✅ **Metadata Support**: Full support for `truncatedFields` and `fullLogFile` fields

## Exposed Tools

### 1. `log.open`
**Description**: Open a JSONL log file and return session id

**Parameters**:
- `path` (string): Path to JSONL log file

**Returns**:
```json
{
  "sessionId": "string",
  "count": number
}
```

**Usage**: Initialize a log analysis session by opening a JSONL file.

---

### 2. `log.schema`
**Description**: Return discovered fields and a sample row

**Parameters**:
- `sessionId` (string): Session ID from log.open

**Returns**:
```json
{
  "fields": {"fieldName": count},
  "sampleRow": object | null
}
```

**Usage**: Explore the structure and fields available in the loaded log.

---

### 3. `log.search`
**Description**: Filter rows by mini-DSL and return selected fields

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Filter string (contains match)
- `fields` (string[], optional): Fields to include in results
- `limit` (number, optional): Max results (default: 200)
- `sort` (string, optional): Field to sort by

**Returns**: Array of filtered log events

**Usage**: Search and filter log events with optional field projection and sorting.

---

### 4. `log.aggregate`
**Description**: Group and aggregate metrics over fields

**Parameters**:
- `sessionId` (string): Session ID
- `groupBy` (string[]): Fields to group by
- `metric` (object):
  - `op` (enum): "count" | "sum" | "avg" | "max" | "min"
  - `field` (string, optional): Field to aggregate
- `filter` (string, optional): Filter string

**Returns**:
```json
[
  {"key": "grouped_value", "value": number}
]
```

**Usage**: Perform aggregations like counting events by method or calculating average duration.

---

### 5. `log.topK`
**Description**: Top K values for a field

**Parameters**:
- `sessionId` (string): Session ID
- `byField` (string): Field to analyze
- `k` (number, optional): Number of results (default: 20)
- `filter` (string, optional): Filter string

**Returns**:
```json
[
  {"value": "string", "count": number}
]
```

**Usage**: Find most frequent values for a specific field (e.g., top methods, classes).

---

### 6. `log.timeline`
**Description**: Ordered events matching a filter

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Filter string
- `fields` (string[], optional): Fields to include

**Returns**: Array of events sorted by timestamp

**Usage**: Get chronological view of events for time-based analysis.

---

### 7. `log.flow`
**Description**: Build correlation chains by keys

**Parameters**:
- `sessionId` (string): Session ID
- `keys` (string[]): Fields to correlate by

**Returns**:
```json
[
  {
    "key": "correlation_key",
    "count": number,
    "first": timestamp,
    "last": timestamp
  }
]
```

**Usage**: Group related events by correlation keys (e.g., requestId, userId).

---

### 8. `log.errors`
**Description**: List likely error events by regex on standard fields

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Additional filter

**Returns**: Array of error events (max 500)

**Usage**: Automatically detect errors using pattern matching on result field.

---

### 9. `log.sample`
**Description**: Sample rows matching a filter

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Filter string
- `limit` (number, optional): Max samples (default: 50)

**Returns**: Array of sampled events

**Usage**: Get representative sample of log events for inspection.

---

### 10. `log.export`
**Description**: Export filtered rows to CSV or JSON

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Filter string
- `fields` (string[], optional): Fields to export
- `to` (enum): "csv" | "json"

**Returns**: Formatted data as CSV or JSON string

**Usage**: Export analysis results for external processing or reporting.

---

## Common Workflows

### Basic Analysis Workflow
```
1. log.open → Get sessionId
2. log.schema → Understand data structure
3. log.search → Filter and explore events
4. log.aggregate → Calculate metrics
5. log.export → Save results
```

### Error Investigation Workflow
```
1. log.open → Get sessionId
2. log.errors → Find error events
3. log.timeline → View chronological context
4. log.flow → Correlate related events
```

### Performance Analysis Workflow
```
1. log.open → Get sessionId
2. log.aggregate → Calculate duration metrics
3. log.topK → Find slowest operations
4. log.timeline → Analyze timing patterns
```

## Field Conventions

### Standard Fields
- `timestamp`: Event timestamp (number)
- `class`: Java/service class name
- `method`: Method/function name
- `event`: Event type or name
- `args`: Method arguments (any)
- `result`: Method result (any)
- `durationMillis`: Duration in milliseconds
- `durationMicros`: Duration in microseconds

### Custom Fields
Any additional fields in JSONL will be automatically discovered and accessible.

## Build Information

**Build Command**: `npm run build`
**TypeScript Config**:
- Target: ES2022
- Module: NodeNext
- Output: dist/

**Fixed Issues**:
- ✅ Python-style conditional expressions → JavaScript ternary operators
- ✅ Python `len()` → JavaScript `.length`
- ✅ Python string methods → JavaScript equivalents
- ✅ Type safety improvements
- ✅ Proper error handling

## MCP Configuration

Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/server.js"],
      "cwd": "/path/to/mcp-server",
      "env": {}
    }
  }
}
```

## Development

**Install Dependencies**:
```bash
npm install
```

**Build**:
```bash
npm run build
```

**Development Mode**:
```bash
npm run dev
```

**Start Server**:
```bash
npm start
```

---

### 11. `log.expand`
**Description**: Expand truncated log by retrieving full data from segmented file

**Parameters**:
- `sessionId` (string): Session ID
- `timestamp` (number): Timestamp of log entry to expand
- `event` (string, optional): Event type (ENTER/EXIT) for disambiguation

**Returns**:
```json
{
  "truncatedLog": {...},
  "fullLog": {...},
  "truncatedFields": {
    "args": {"originalLength": 1500, "threshold": 1000},
    "result": {"originalLength": 5000, "threshold": 1000}
  },
  "message": "Full log data retrieved successfully"
}
```

**Usage**: Retrieve complete data for logs with truncated fields

**Example**:
```javascript
// Find truncated log
const results = await logSearch(sessionId, {filter: "exceptionHandler"});
const truncated = results.find(r => r.truncatedFields);

// Expand to get full data
const fullData = await logExpand(sessionId, {
  timestamp: truncated.timestamp,
  event: truncated.event
});

console.log(fullData.fullLog.args); // Complete exception message
```

---

### 12. `log.searchExpanded`
**Description**: Search logs with automatic expansion of truncated entries

**Parameters**:
- `sessionId` (string): Session ID
- `filter` (string, optional): Filter expression
- `fields` (string[], optional): Fields to return
- `limit` (number, optional): Max results (default: 200)
- `autoExpand` (boolean, optional): Automatically expand truncated logs (default: false)

**Returns**:
Array of log entries with `_expandedData` field for truncated logs when `autoExpand=true`

**Usage**: Search with automatic full data retrieval for analysis

**Example**:
```javascript
// Search with auto-expansion
const results = await logSearchExpanded(sessionId, {
  filter: "exception",
  autoExpand: true
});

results.forEach(log => {
  if (log._expandedData) {
    console.log("Full args:", log._expandedData.args);
    console.log("Full result:", log._expandedData.result);
  }
});
```

---

## Truncated Log Workflow

### Standard Workflow (Manual Expansion)
```javascript
// 1. Open log
const session = await logOpen({path: "flowtrace.jsonl"});

// 2. Search for events
const results = await logSearch(session.sessionId, {
  filter: "exceptionHandler"
});

// 3. Check for truncation
const truncated = results.filter(r => r.truncatedFields);

// 4. Expand specific logs
for (const log of truncated) {
  const full = await logExpand(session.sessionId, {
    timestamp: log.timestamp,
    event: log.event
  });
  console.log("Full exception:", full.fullLog.args);
}
```

### Auto-Expansion Workflow (Automatic)
```javascript
// 1. Open log
const session = await logOpen({path: "flowtrace.jsonl"});

// 2. Search with auto-expansion
const results = await logSearchExpanded(session.sessionId, {
  filter: "exception",
  autoExpand: true
});

// 3. Access full data directly
results.forEach(log => {
  if (log._expandedData) {
    console.log("Complete data:", log._expandedData);
  }
});
```

## Status

- ✅ Build: Successful
- ✅ Syntax: Valid TypeScript
- ✅ Tools: 12 tools exposed
- ✅ MCP Integration: Configured
- ✅ Error Handling: Implemented
- ✅ Truncated Log Support: Full expansion capabilities
