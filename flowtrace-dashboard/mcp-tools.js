/**
 * FlowTrace Dashboard MCP Tools
 * Tools for AI agents to analyze performance logs
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const DASHBOARD_URL = 'http://localhost:8765';
let serverProcess = null;

/**
 * Start the FlowTrace Dashboard server
 * @returns {Promise<Object>} Server status
 */
async function startDashboard() {
  return new Promise((resolve, reject) => {
    // Check if server is already running
    axios.get(`${DASHBOARD_URL}/health`)
      .then(response => {
        resolve({
          status: 'already_running',
          message: 'Dashboard server is already running',
          url: DASHBOARD_URL
        });
      })
      .catch(() => {
        // Server not running, start it
        const serverPath = path.join(__dirname, 'server', 'server.js');
        serverProcess = spawn('node', [serverPath], {
          detached: true,
          stdio: 'ignore'
        });

        serverProcess.unref();

        // Wait for server to start
        setTimeout(async () => {
          try {
            await axios.get(`${DASHBOARD_URL}/health`);
            resolve({
              status: 'started',
              message: 'Dashboard server started successfully',
              url: DASHBOARD_URL,
              pid: serverProcess.pid
            });
          } catch (error) {
            reject(new Error('Failed to start dashboard server'));
          }
        }, 2000);
      });
  });
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

    // Analyze the file
    const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
      filePath: filePath
    });

    const { analysisId, fileName, results } = response.data;

    // Generate dashboard URL with analysis ID
    const dashboardURL = `${DASHBOARD_URL}?analysis=${analysisId}`;

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

    const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
      filePath: filePath
    });

    const { results } = response.data;

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
    throw new Error(`Failed to get slow methods: ${error.message}`);
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
    throw new Error(`Failed to get bottlenecks: ${error.message}`);
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
    throw new Error(`Failed to get error hotspots: ${error.message}`);
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
    throw new Error(`Failed to get performance summary: ${error.message}`);
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
