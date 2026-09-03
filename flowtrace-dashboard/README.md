# FlowTrace Performance Dashboard

Interactive web dashboard for analyzing FlowTrace performance logs and identifying bottlenecks.

## Features

- **📊 Performance Analysis**: Analyze flowtrace.jsonl files to identify slow methods and bottlenecks
- **🎯 Bottleneck Detection**: Impact score-based analysis (callCount × avgDuration)
- **📈 Visualizations**: Time distribution charts and detailed metrics
- **🔍 Error Tracking**: Error hotspot detection and analysis
- **💾 File Upload**: Drag & drop interface for JSONL files
- **🤖 CLI & MCP Tools**: Command-line and programmatic access for AI agents
- **📱 Responsive Design**: Works on desktop and mobile devices

## Installation

```bash
cd flowtrace-dashboard
npm install
```

## Quick Start

### Option 1: Web Dashboard (Manual Upload)

```bash
npm start
# Open http://localhost:8765 and drag/drop flowtrace.jsonl
```

### Option 2: CLI (Auto-Open in Browser)

```bash
node cli.js open flowtrace.jsonl
# Analyzes file and provides dashboard URL
```

### Option 3: Programmatic (MCP Tools)

```javascript
const tools = require('./mcp-tools');

// Open file directly in dashboard
const result = await tools.openInDashboard('/path/to/flowtrace.jsonl');
console.log(result.dashboardURL); // http://localhost:8765?analysis=...

// Or just get analysis data
const slowMethods = await tools.getSlowMethods('/path/to/flowtrace.jsonl', 10);
const bottlenecks = await tools.getBottlenecks('/path/to/flowtrace.jsonl', 10);
```

## CLI Commands

### Open in Dashboard
```bash
node cli.js open flowtrace.jsonl
```
Analyzes file, starts server (if needed), and provides dashboard URL with results

### Analyze File
```bash
node cli.js analyze flowtrace.jsonl
```
Shows performance summary in terminal

### Top Slow Methods
```bash
node cli.js slow flowtrace.jsonl 20
```
Lists top 20 slowest methods with percentiles

### Performance Bottlenecks
```bash
node cli.js bottlenecks flowtrace.jsonl 15
```
Lists top 15 bottlenecks by impact score

### Error Hotspots
```bash
node cli.js errors flowtrace.jsonl
```
Shows methods with exceptions

### Start Server Only
```bash
node cli.js start
```
Starts dashboard server at http://localhost:8765

## MCP Tools API

For AI agents and programmatic access:

### startDashboard()
Start the dashboard server (auto-detects if already running)

```javascript
const result = await tools.startDashboard();
// { status: 'started', url: 'http://localhost:8765', pid: 12345 }
```

### openInDashboard(filePath)
Analyze file and get dashboard URL with embedded results

```javascript
const result = await tools.openInDashboard('/path/to/flowtrace.jsonl');
console.log(result.dashboardURL); // Open this in browser
console.log(result.summary);      // Quick summary stats
console.log(result.slowMethods);  // Top 5 slow methods
console.log(result.bottlenecks);  // Top 5 bottlenecks
```

### analyzeFile(filePath)
Get full analysis without opening UI

```javascript
const result = await tools.analyzeFile('/path/to/flowtrace.jsonl');
console.log(result.performance.summary);
console.log(result.performance.slowMethods);
console.log(result.performance.bottlenecks);
```

### getSlowMethods(filePath, top)
Get top N slowest methods

```javascript
const methods = await tools.getSlowMethods('/path/to/flowtrace.jsonl', 10);
methods.forEach(m => console.log(m.method, m.avgDuration));
```

### getBottlenecks(filePath, top)
Get top N bottlenecks by impact score

```javascript
const bottlenecks = await tools.getBottlenecks('/path/to/flowtrace.jsonl', 10);
bottlenecks.forEach(b => console.log(b.method, b.impactScore));
```

### getErrorHotspots(filePath)
Get methods with exceptions

```javascript
const errors = await tools.getErrorHotspots('/path/to/flowtrace.jsonl');
errors.forEach(e => console.log(e.method, e.exceptionCount));
```

### getPerformanceSummary(filePath)
Get high-level performance summary

```javascript
const summary = await tools.getPerformanceSummary('/path/to/flowtrace.jsonl');
console.log(summary.totalCalls, summary.avgDuration, summary.totalMethods);
```

## Web Dashboard Features

### Summary Cards
- Total calls
- Average duration
- Total methods analyzed
- Error rate percentage

### Analysis Tabs

**🐌 Slow Methods**
- Methods sorted by average duration
- P50, P95, P99 percentiles
- Total time spent
- Call count

**🔴 Bottlenecks**
- High-impact methods (frequency × duration)
- Impact score ranking
- Optimization targets

**📊 Time Distribution**
- Visual histogram of call durations
- Percentage distribution across buckets
- Identifies performance patterns

**❌ Error Hotspots**
- Methods with exceptions
- Error rates and counts
- Exception tracking

## Architecture

```
flowtrace-dashboard/
├── analyzer/                # Core analysis library
│   ├── parsers/
│   │   └── jsonl-parser.js  # JSONL file parser
│   ├── metrics/
│   │   └── performance.js   # Performance analysis algorithms
│   └── index.js             # Main analyzer entry point
├── server/                  # Express backend
│   ├── api/
│   │   └── analyze.js       # API endpoints
│   └── server.js            # Server (port 8765)
├── public/                  # Frontend assets
│   ├── css/
│   │   └── dashboard.css    # Styles
│   ├── js/
│   │   ├── lib/
│   │   │   └── api-client.js       # API wrapper
│   │   ├── components/
│   │   │   ├── file-uploader.js    # Upload handler
│   │   │   ├── metrics-panel.js    # Summary cards
│   │   │   ├── table-renderer.js   # Data tables
│   │   │   └── chart-renderer.js   # Chart.js integration
│   │   ├── vendor/
│   │   │   └── chart.umd.min.js    # Vendored, so the CSP can be script-src 'self'
│   │   ├── app.js                  # Main application
│   │   └── app-init.js             # ?analysis=<id> bootstrap (no inline script)
│   └── index.html           # Dashboard UI
├── mcp-tools.js             # MCP tools for AI agents
├── cli.js                   # Command-line interface
└── uploads/                 # Uploaded files (auto-created)
```

## API Endpoints

### POST /api/analyze
Upload and analyze a flowtrace.jsonl file (multipart/form-data)

### GET /api/config
Roots and limits this server enforces

### POST /api/analyze-file
Analyze a file from filesystem path (no upload needed)

```json
{
  "filePath": "/absolute/path/to/flowtrace.jsonl"
}
```

**Response**:
```json
{
  "analysisId": "analysis-1234567890",
  "fileName": "flowtrace.jsonl",
  "filePath": "/path/to/file",
  "results": {
    "fileStats": { "totalEvents": 1000, "totalLines": 1000 },
    "performance": {
      "summary": { "totalCalls": 500, "avgDuration": 45.2 },
      "slowMethods": [...],
      "bottlenecks": [...],
      "timeDistribution": {...},
      "errorHotspots": [...]
    }
  }
}
```

### GET /api/analyze/:id
Retrieve cached analysis by ID

### GET /api/analyze
List all cached analyses

### DELETE /api/analyze/:id
Delete analysis and uploaded file

## Security model

This is a **local developer tool**, and it is built as one:

- It binds **127.0.0.1** by default. `app.listen(PORT)` would bind every
  interface, and every message it prints says "localhost" — so a developer on
  a shared network was serving a filesystem-backed API to the whole LAN with
  no hint of it. Widen it deliberately with `FLOWTRACE_DASHBOARD_HOST`.
- `POST /api/analyze-file` reads a path only if it resolves (through
  `realpath`, so symlinks cannot escape) inside an **allowed root**: the
  directory the server was started in, plus `FLOWTRACE_DASHBOARD_ROOTS`.
  Anything else is `403 {code: "OUTSIDE_ROOTS"}`, and `flowtrace analyze`
  falls back to uploading the file.
- Uploads are stored under a **server-chosen random name**, never the client's
  `originalname`, and are size-capped.
- There is **no authentication**. Do not expose this on a network. Traces
  routinely contain arguments and return values; treat the machine running it
  as the trust boundary.
- CORS is restricted to localhost origins, but note what that does and does
  not do: it gates whether another origin may *read* a response. It does not
  stop a `text/plain` POST from reaching `/api/trace` (that is a CORS "simple
  request", and it is what `sendBeacon` sends). What bounds the collector is
  schema validation, the size/count limits, and the loopback bind.
- Responses to the client never carry server filesystem paths or raw error
  messages.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FLOWTRACE_DASHBOARD_HOST` | `127.0.0.1` | Interface to bind. `0.0.0.0` exposes it on the network (a warning is printed). |
| `FLOWTRACE_DASHBOARD_PORT` (or `PORT`) | `8765` | Listening port. |
| `FLOWTRACE_DASHBOARD_ROOTS` | — | Extra directories `analyze-file` may read, `:`-separated. The server's cwd is always allowed. |
| `FLOWTRACE_DASHBOARD_MAX_UPLOAD_BYTES` | `209715200` (200 MB) | Largest accepted upload; over it is `413`. |
| `FLOWTRACE_DASHBOARD_MAX_ANALYSES` | `20` | Analyses kept in memory; the oldest is evicted and its upload deleted. |
| `FLOWTRACE_DASHBOARD_UPLOAD_DIR` | `./uploads` | Where uploads are stored. |
| `FLOWTRACE_CORS_ORIGIN` | localhost only | Comma-separated origins allowed to read API responses. |
| `FLOWTRACE_COLLECTOR_OUTPUT` | `flowtrace.jsonl` | Where `POST /api/trace` appends browser events. |
| `FLOWTRACE_COLLECTOR_MAX_BODY` / `_MAX_EVENTS` | `1mb` / `1000` | Collector request limits. |

```bash
FLOWTRACE_DASHBOARD_PORT=9000 npm start
```

**Dashboard URL**: `http://localhost:8765`

`GET /api/config` reports the live values of the roots and limits, so a client
can explain a rejection instead of guessing.

## Performance Metrics

### Slow Methods
Methods sorted by average duration, including:
- Call count
- Average duration
- P50/P95/P99 percentiles
- Total time spent

### Bottlenecks
High-impact methods identified by:
- **Impact Score** = callCount × avgDuration
- Methods with high frequency AND high duration
- Critical optimization targets

### Time Distribution
Duration buckets showing:
- Number of calls per range
- Percentage distribution
- Visual histogram

### Error Hotspots
Methods with exceptions:
- Total calls vs exception count
- Error rate percentage
- Exception tracking

## Integration with FlowTrace Agents

These referenced the v1 agents, which have been deleted. Capture now lives in
`capture/<lang>/` and the simplest way to produce a trace is the CLI:

```bash
flowtrace run -- node your-app.js      # or: python your_script.py, java -jar app.jar
node cli.js open flowtrace.jsonl
```

### Node / TypeScript, without the CLI
```bash
node --import ./capture/node/src/bootstrap.mjs your-app.js
```

### Python, without the CLI
```bash
PYTHONPATH=capture/python/stub:capture/python FLOWTRACE_ENABLE=1 python your_script.py
```

### Any Agent
```bash
# After running any FlowTrace agent, use CLI to analyze
node cli.js open /path/to/generated/flowtrace.jsonl
```

## AI Agent Usage

The MCP tools allow AI agents to programmatically analyze performance logs:

```javascript
// Example: AI agent analyzing logs
const tools = require('./mcp-tools');

// Open file in dashboard for user
const result = await tools.openInDashboard('flowtrace.jsonl');
console.log(`Dashboard ready at: ${result.dashboardURL}`);

// Get insights for AI analysis
const bottlenecks = await tools.getBottlenecks('flowtrace.jsonl', 5);
console.log('Top bottlenecks for optimization:');
bottlenecks.forEach(b => {
  console.log(`- ${b.method}: ${b.impactScore.toFixed(0)} impact score`);
});

// Check for errors
const errors = await tools.getErrorHotspots('flowtrace.jsonl');
if (errors.length > 0) {
  console.log('\nError hotspots requiring attention:');
  errors.forEach(e => {
    const rate = (e.exceptionCount / e.callCount * 100).toFixed(2);
    console.log(`- ${e.method}: ${rate}% error rate`);
  });
}
```

## Technology Stack

- **Backend**: Express.js, Node.js (port 8765)
- **Frontend**: Vanilla JavaScript, Chart.js
- **File Upload**: Multer
- **Analysis**: Custom performance analyzer with percentile calculations
- **CLI**: Node.js with axios for API calls
- **MCP Tools**: Programmatic API for AI agents

## Development

### Run in Development Mode
```bash
npm run dev  # Starts server with auto-reload
```

### Run Tests
```bash
npm test
```

### Analyze a Sample File
```bash
node cli.js analyze path/to/flowtrace.jsonl
```

## Troubleshooting

### Port Already in Use
Dashboard uses port **8765** (not 3000) to avoid conflicts. If still needed:
```bash
PORT=9000 npm start
```

### File Upload Fails
- Ensure file is `.jsonl` format
- Check file size (max 100MB by default)
- Verify JSONL format (one JSON object per line)

### Server Won't Start
- Check if port 8765 is available
- Verify Node.js version (requires Node.js 14+)
- Check dependencies are installed (`npm install`)

### Analysis Shows No Data
- Verify JSONL file contains EXIT events
- Check log format matches FlowTrace specification
- Ensure events have `duration` and `method` fields

### CLI Command Not Found
```bash
chmod +x cli.js
node cli.js open flowtrace.jsonl
```

## Example Output

```bash
$ node cli.js open flowtrace.jsonl

🔍 Analyzing /path/to/flowtrace.jsonl...

✅ Analysis complete! Open in browser: http://localhost:8765?analysis=analysis-1234567890

📊 Summary:
   Total Calls: 31
   Avg Duration: 56865.00ms
   Total Methods: 19
   Exceptions: 3

🐌 Top 5 Slow Methods:
   1. main - 375885.00ms avg
   2. run - 362006.00ms avg
   3. runOrderScenario - 154926.00ms avg
   4. processOrder - 111868.00ms avg
   5. runUserScenario - 106043.00ms avg

🔴 Top 5 Bottlenecks:
   1. main - Impact: 375885
   2. run - Impact: 362006
   3. sleep - Impact: 177115
   4. runOrderScenario - Impact: 154926
   5. sleep - Impact: 140236
```

## License

Part of the FlowTrace project - Multi-language debugging and performance analysis system.

## Author

Juan Pablo Diaz <juanpablo516@gmail.com>
