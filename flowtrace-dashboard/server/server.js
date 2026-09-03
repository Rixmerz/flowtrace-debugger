/**
 * FlowTrace Dashboard Server
 * Express server for performance analysis dashboard
 *
 * Security model, in one paragraph: this is a LOCAL developer tool. It reads
 * trace files from disk, accepts uploads, and appends browser events to a
 * file, all without authentication — so it binds to the loopback interface by
 * default (FLOWTRACE_DASHBOARD_HOST widens that deliberately), confines the
 * paths it will read to an allow-list of roots, never stores an upload under
 * a client-chosen name, and sends a Content-Security-Policy so the UI cannot
 * be turned against the API by injected script. Traces routinely contain
 * arguments and return values; treat the machine running this as the trust
 * boundary and do not expose it on a network.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const analyzeRouter = require('./api/analyze');
const collectRouter = require('./api/collect');

const app = express();
const PORT = process.env.FLOWTRACE_DASHBOARD_PORT || process.env.PORT || 8765;

/**
 * Loopback only, unless told otherwise. `app.listen(PORT)` binds every
 * interface, and every message this server prints says "localhost" — so a
 * developer on a shared network was serving their filesystem-backed API to
 * the whole LAN without a single hint. Set FLOWTRACE_DASHBOARD_HOST=0.0.0.0
 * to expose it on purpose.
 */
const HOST = process.env.FLOWTRACE_DASHBOARD_HOST || '127.0.0.1';

/**
 * What CORS does and does not do here.
 *
 * It gates whether a page on another origin may READ a response. It does not
 * stop the request from being delivered: a `text/plain` POST is a CORS
 * "simple request" and reaches /api/trace whether or not the origin is
 * allowed (and sendBeacon, which the browser layer uses on unload, is exactly
 * that kind of request). The real bounds on the collector are the ones in
 * collect.js — schema validation, size and count limits — plus loopback
 * binding. The restricted origin still matters for the JSON API: it keeps a
 * hostile page from reading analyses or listing files through the browser.
 * FLOWTRACE_CORS_ORIGIN widens it (e.g. a dev server on another host).
 */
const corsOrigin = process.env.FLOWTRACE_CORS_ORIGIN
  ? process.env.FLOWTRACE_CORS_ORIGIN.split(',').map((s) => s.trim())
  : /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

app.use(cors({ origin: corsOrigin }));

/**
 * Every script and stylesheet is served from this origin (Chart.js is
 * vendored under public/js/vendor), so the policy can be strict: no inline
 * script, nothing from a CDN. An XSS in the UI would otherwise have the
 * same-origin API — and with it any trace file inside the allowed roots.
 */
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

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

// Unknown API routes answer JSON, not Express's HTML 404 page.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

/**
 * Last-resort error handler. Messages are generic on purpose: an ENOENT or
 * EACCES message carries an absolute filesystem path, and the client is not
 * entitled to that. The full error goes to the server log.
 */
// Four parameters is what marks this as Express's error handler; `next` is
// part of that signature even where it is only used to re-delegate.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[flowtrace-dashboard]', err);
  res.status(status).json({ error: status >= 500 ? 'internal error' : (err.message || 'bad request') });
});

// Start the server only when this file is the entry point. Importing it used
// to bind port 8765 as a side effect, so any test that wanted the app object
// also got a listening socket it never asked for — one that keeps the process
// alive and collides with a dashboard already running.
if (require.main === module) startServer();

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  FlowTrace Performance Dashboard');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Server running at: http://${shownHost}:${PORT}  (bound to ${HOST})`);
    console.log(`  Collector endpoint: POST http://${shownHost}:${PORT}/api/trace`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
      console.log('  WARNING: reachable from the network; this API has no authentication.');
    }
    console.log('');
    console.log('  Upload a flowtrace.jsonl file to start analyzing');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  });

  // Without this, Node's default behavior for an unhandled 'error' event on
  // a server is to throw — so a second `node server.js` on an already-taken
  // port crashed with a raw uncaught-exception stack trace instead of a
  // clean message, and left the process (and stdio) hanging around.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `FlowTrace dashboard: port ${PORT} is already in use — something else ` +
        '(quite possibly another `flowtrace analyze`) already owns it. Set ' +
        'FLOWTRACE_DASHBOARD_PORT to use another one.'
      );
      process.exit(1);
    }
    throw err;
  });

  return server;
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.HOST = HOST;
module.exports.PORT = PORT;
