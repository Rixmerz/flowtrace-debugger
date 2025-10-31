#!/usr/bin/env node

/**
 * Simple Express API backend for Angular FlowTrace testing
 * This demonstrates the truncation system with server-side operations
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Generate a user with detailed information
function generateUser(id) {
  return {
    id,
    name: `User ${id} - Full Name With Many Details`,
    email: `user${id}@example.com`,
    profile: {
      bio: `This is a detailed biography for user ${id}. `.repeat(10),
      preferences: {
        theme: 'dark',
        notifications: true,
        language: 'en',
        timezone: 'UTC',
        settings: { option1: true, option2: false, option3: 'value' }
      },
      metadata: {
        created: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        loginCount: Math.floor(Math.random() * 1000),
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5']
      }
    },
    extraData: `Additional data field with lots of content. `.repeat(20)
  };
}

// API Endpoints

// Test 1: Generate large dataset (large result)
app.get('/api/users', (req, res) => {
  console.log('Generating large dataset...');
  const count = parseInt(req.query.count) || 100;
  const users = [];

  for (let i = 0; i < count; i++) {
    users.push(generateUser(i));
  }

  console.log(`Generated ${users.length} users`);
  res.json({ users, count: users.length });
});

// Test 2: Process large data (large args AND result)
app.post('/api/users/process', (req, res) => {
  console.log('Processing large dataset...');
  const { users } = req.body;

  if (!users || !Array.isArray(users)) {
    return res.status(400).json({ error: 'Invalid users data' });
  }

  // Process users - transforms data (large input and output)
  const processed = users.map(user => ({
    ...user,
    processed: true,
    processedAt: new Date().toISOString(),
    computedFields: {
      nameLength: user.name.length,
      hasProfile: !!user.profile,
      tagCount: user.profile?.metadata?.tags?.length || 0
    },
    enrichedData: `Enriched data for ${user.name}. `.repeat(15)
  }));

  const summary = {
    totalProcessed: processed.length,
    timestamp: new Date().toISOString(),
    statistics: {
      avgNameLength: processed.reduce((sum, u) => sum + u.computedFields.nameLength, 0) / processed.length,
      withProfiles: processed.filter(u => u.computedFields.hasProfile).length,
      totalTags: processed.reduce((sum, u) => sum + u.computedFields.tagCount, 0)
    }
  };

  console.log(`Processed ${processed.length} users`);
  res.json({ processed, summary });
});

// Test 3: Async operation with large response
app.get('/api/users/async', async (req, res) => {
  console.log('Fetching data asynchronously...');

  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 100));

  const count = parseInt(req.query.count) || 50;
  const users = [];

  for (let i = 0; i < count; i++) {
    users.push(generateUser(i));
  }

  console.log(`Fetched ${users.length} users asynchronously`);
  res.json({ users, fetchedAt: new Date().toISOString() });
});

// Test 4: Exception with large data
app.post('/api/users/error', (req, res) => {
  console.log('Simulating error with large context...');
  const { users } = req.body;

  // Throw error with large context
  const error = new Error(`Processing failed for large dataset: ${JSON.stringify(users).substring(0, 200)}...`);
  console.error('Error:', error.message);

  res.status(500).json({
    error: error.message,
    context: { userCount: users?.length, timestamp: new Date().toISOString() }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`
======================================
FlowTrace Test API Server
======================================

Server running on: http://localhost:${PORT}

Available endpoints:
  GET  /api/users          - Generate large dataset
  POST /api/users/process  - Process large data
  GET  /api/users/async    - Async large data fetch
  POST /api/users/error    - Error with large context
  GET  /api/health         - Health check

FlowTrace Configuration:
  This server should be run with FlowTrace instrumentation
  to test the truncation system.

To run with FlowTrace:
  FLOWTRACE_ENABLED=true \\
  FLOWTRACE_TRUNCATE_THRESHOLD=1000 \\
  FLOWTRACE_ENABLE_SEGMENTATION=true \\
  node --require ../../../flowtrace-agent-js/src/loader.js backend-api.js

======================================
`);
});
