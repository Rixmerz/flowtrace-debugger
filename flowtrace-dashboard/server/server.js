/**
 * FlowTrace Dashboard Server
 * Express server for performance analysis dashboard
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const analyzeRouter = require('./api/analyze');

const app = express();
const PORT = process.env.PORT || 8765;

// Middleware
app.use(cors());
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

/**
 * Pre-load the trace named by FLOWTRACE_FILE, if any.
 *
 * `flowtrace analyze` has always passed this variable when spawning the dashboard,
 * and nothing ever read it: the command printed the file path, opened the browser
 * and showed an empty dashboard, leaving the user to locate and upload the same
 * file by hand. Opening the dashboard ON a given trace is the whole point of the
 * command.
 *
 * Failure is reported but not fatal — a bad path should leave a usable dashboard
 * you can still upload to, rather than refusing to start.
 *
 * @returns {Promise<void>}
 */
async function preloadFromEnv() {
  const target = process.env.FLOWTRACE_FILE;
  if (!target) return;
  try {
    const entry = await analyzeRouter.ingestFile(target);
    // fileStats.totalEvents — results has no top-level `summary`.
    const events = entry.results?.fileStats?.totalEvents;
    console.log(`  Pre-loaded: ${entry.fileName}${events != null ? ` (${events} eventos)` : ''}`);
  } catch (err) {
    console.error(`  WARNING: could not pre-load FLOWTRACE_FILE (${target}): ${err.message}`);
  }
}

// Start server
const server = app.listen(PORT, async () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FlowTrace Performance Dashboard');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log('');
  await preloadFromEnv();
  if (!process.env.FLOWTRACE_FILE) {
    console.log('  Upload a flowtrace.jsonl file to start analyzing');
  }
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
});

/**
 * Report a port conflict instead of dying on an unhandled 'error' event.
 *
 * Without this the process printed a raw EADDRINUSE stack trace while
 * `flowtrace analyze` went on to announce the dashboard URL and open the browser
 * — pointing the user at whatever was already listening on 8765. That is worse
 * than a crash: a stale dashboard from a previous run looks like a working one,
 * and it cost real debugging time during this audit.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ERROR: el puerto ${PORT} ya está en uso.`);
    console.error('  Otro dashboard (u otro servicio) está escuchando ahí.');
    console.error(`  Cierra ese proceso, o usa PORT=<otro> para elegir otro puerto.`);
    console.error('');
    process.exit(1);
  }
  console.error('  ERROR del servidor:', err.message);
  process.exit(1);
});

module.exports = app;
