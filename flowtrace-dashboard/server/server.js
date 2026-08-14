/**
 * FlowTrace Dashboard Server
 * Express server for performance analysis dashboard
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const analyzeRouter = require('./api/analyze');
const collectRouter = require('./api/collect');

const app = express();
const PORT = process.env.PORT || 8765;

/**
 * CORS is restricted to localhost origins by default, because /api/trace
 * appends to a file on disk: with `cors()` wide open, any site the developer
 * visited could POST into their trace file. Set FLOWTRACE_CORS_ORIGIN to widen
 * it deliberately (e.g. a dev server on another host).
 */
const corsOrigin = process.env.FLOWTRACE_CORS_ORIGIN
  ? process.env.FLOWTRACE_CORS_ORIGIN.split(',').map((s) => s.trim())
  : /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

app.use(cors({ origin: corsOrigin }));

// The collector mounts BEFORE the global body parsers, and that ordering is
// load-bearing: express.json() defaults to a 100 KB limit and would consume
// the body first, silently capping the collector's own configurable limit and
// making FLOWTRACE_COLLECTOR_MAX_BODY a no-op. It also needs to parse
// text/plain, which the global JSON parser does not claim.
app.use('/api', collectRouter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', analyzeRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'flowtrace-dashboard' });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server only when this file is the entry point. Importing it used
// to bind port 8765 as a side effect, so any test that wanted the app object
// also got a listening socket it never asked for — one that keeps the process
// alive and collides with a dashboard already running.
if (require.main === module) startServer();

function startServer() {
  return app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  FlowTrace Performance Dashboard');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Server running at: http://localhost:${PORT}`);
    console.log(`  Collector endpoint: POST http://localhost:${PORT}/api/trace`);
    console.log('');
    console.log('  Upload a flowtrace.jsonl file to start analyzing');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  });
}

module.exports = app;
module.exports.startServer = startServer;
