/**
 * FlowTrace Dashboard MCP Tools
 * Tools for AI agents to analyze performance logs
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const HOST = process.env.FLOWTRACE_DASHBOARD_HOST || '127.0.0.1';
const PORT = process.env.FLOWTRACE_DASHBOARD_PORT || process.env.PORT || 8765;
const DASHBOARD_URL = `http://${HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST}:${PORT}`;
let serverProcess = null;

/**
 * Whether the thing answering on the port is actually this dashboard. Another
 * service on 8765 would otherwise be reported as "already running" and every
 * request after that would fail in confusing ways.
 */
async function isDashboardUp() {
  try {
    const res = await axios.get(`${DASHBOARD_URL}/health`, { timeout: 1000 });
    return res.data && res.data.service === 'flowtrace-dashboard';
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start the FlowTrace Dashboard server
 * @returns {Promise<Object>} Server status
 */
async function startDashboard() {
  if (await isDashboardUp()) {
    return {
      status: 'already_running',
      message: 'Dashboard server is already running',
      url: DASHBOARD_URL
    };
  }

  // process.execPath, not 'node': the interpreter running this is the one
  // that is known to exist, and a PATH without `node` (nvm, a pinned
  // toolchain) is common.
  const serverPath = path.join(__dirname, 'server', 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  serverProcess.unref();

  // Poll instead of a fixed sleep: ready in a few hundred ms on a warm
  // machine, several seconds on a cold one.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await isDashboardUp()) {
      return {
        status: 'started',
        message: 'Dashboard server started successfully',
        url: DASHBOARD_URL,
        pid: serverProcess.pid
      };
    }
    await sleep(150);
  }
  throw new Error(`Failed to start dashboard server on ${DASHBOARD_URL}`);
}

/**
 * Sends a path to the server, falling back to an upload when the path is
 * outside the directories the server is allowed to read (403 OUTSIDE_ROOTS).
 */
async function submitFile(filePath) {
  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, { filePath });
    return response.data;
  } catch (error) {
    const code = error.response && error.response.data && error.response.data.code;
    if (!(error.response && error.response.status === 403 && code === 'OUTSIDE_ROOTS')) throw error;
  }
  const fs = require('fs');
  const FormData = globalThis.FormData;
  const Blob = globalThis.Blob;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const response = await axios.post(`${DASHBOARD_URL}/api/analyze`, form);
  return response.data;
}

/**
 * Open a flowtrace.jsonl file in the dashboard
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @returns {Promise<Object>} Analysis results and dashboard URL
 */
async function openInDashboard(filePath) {
  try {
    // Ensure server is running
    await startDashboard();

    const { analysisId, fileName, results } = await submitFile(filePath);

    // Generate dashboard URL with analysis ID
    const dashboardURL = `${DASHBOARD_URL}?analysis=${encodeURIComponent(analysisId)}`;

    return {
      success: true,
      analysisId,
      fileName,
      dashboardURL,
      summary: {
        totalCalls: results.performance.summary.totalCalls,
        avgDuration: results.performance.summary.avgDuration,
        totalMethods: results.performance.summary.totalMethods,
        totalExceptions: results.performance.summary.totalExceptions
      },
      slowMethods: results.performance.slowMethods.slice(0, 5),
      bottlenecks: results.performance.bottlenecks.slice(0, 5),
      message: `✅ Analysis complete! Open in browser: ${dashboardURL}`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `❌ Failed to analyze file: ${error.message}`
    };
  }
}

/**
 * Analyze a flowtrace.jsonl file and return results (no UI)
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeFile(filePath) {
  try {
    await startDashboard();

    const { results } = await submitFile(filePath);

    return {
      success: true,
      fileStats: results.fileStats,
      performance: results.performance
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get top slow methods from a file
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @param {number} top - Number of top results (default: 10)
 * @returns {Promise<Array>} Top slow methods
 */
async function getSlowMethods(filePath, top = 10) {
  try {
    const result = await analyzeFile(filePath);
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.performance.slowMethods.slice(0, top);

  } catch (error) {
    throw new Error(`Failed to get slow methods: ${error.message}`, { cause: error });
  }
}

/**
 * Get performance bottlenecks from a file
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @param {number} top - Number of top results (default: 10)
 * @returns {Promise<Array>} Top bottlenecks
 */
async function getBottlenecks(filePath, top = 10) {
  try {
    const result = await analyzeFile(filePath);
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.performance.bottlenecks.slice(0, top);

  } catch (error) {
    throw new Error(`Failed to get bottlenecks: ${error.message}`, { cause: error });
  }
}

/**
 * Get error hotspots from a file
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @returns {Promise<Array>} Error hotspots
 */
async function getErrorHotspots(filePath) {
  try {
    const result = await analyzeFile(filePath);
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.performance.errorHotspots;

  } catch (error) {
    throw new Error(`Failed to get error hotspots: ${error.message}`, { cause: error });
  }
}

/**
 * Get performance summary from a file
 * @param {string} filePath - Absolute path to flowtrace.jsonl file
 * @returns {Promise<Object>} Performance summary
 */
async function getPerformanceSummary(filePath) {
  try {
    const result = await analyzeFile(filePath);
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.performance.summary;

  } catch (error) {
    throw new Error(`Failed to get performance summary: ${error.message}`, { cause: error });
  }
}

module.exports = {
  startDashboard,
  openInDashboard,
  analyzeFile,
  getSlowMethods,
  getBottlenecks,
  getErrorHotspots,
  getPerformanceSummary
};
