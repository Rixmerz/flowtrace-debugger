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

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FlowTrace Performance Dashboard');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log('');
  console.log('  Upload a flowtrace.jsonl file to start analyzing');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
