/**
 * FlowTrace Dashboard MCP Tools
 * Performance analysis and visualization tools
 */

import { z } from "zod";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import axios from "axios";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DASHBOARD_URL = 'http://localhost:8765';
let dashboardProcess: any = null;

async function ensureDashboardRunning(): Promise<boolean> {
  try {
    await axios.get(`${DASHBOARD_URL}/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    // Dashboard not running, start it
    const dashboardPath = path.join(__dirname, '../../flowtrace-dashboard');
    const serverScript = path.join(dashboardPath, 'server/server.js');

    if (!fs.existsSync(serverScript)) {
      throw new Error(`Dashboard not found at ${dashboardPath}. Please install flowtrace-dashboard first.`);
    }

    dashboardProcess = spawn('node', [serverScript], {
      detached: true,
      stdio: 'ignore',
      cwd: dashboardPath
    });

    dashboardProcess.unref();

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      await axios.get(`${DASHBOARD_URL}/health`, { timeout: 2000 });
      return true;
    } catch (err) {
      throw new Error('Failed to start dashboard server');
    }
  }
}

export function registerDashboardTools(mcp: McpServer) {
  mcp.tool(
    "dashboard.open",
    "Open a flowtrace.jsonl file in the performance dashboard and get analysis URL",
    { path: z.string().describe("Absolute path to the flowtrace.jsonl log file to analyze and visualize in the dashboard") },
    async ({ path: filePath }) => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      if (!filePath.endsWith('.jsonl')) {
        throw new Error('File must be a .jsonl file');
      }

      // Ensure dashboard is running
      await ensureDashboardRunning();

      // Analyze the file
      const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
        filePath: path.resolve(filePath)
      });

      const { analysisId, fileName, results } = response.data;
      const dashboardURL = `${DASHBOARD_URL}?analysis=${analysisId}`;

      const summary = {
        totalCalls: results.performance.summary.totalCalls,
        avgDuration: results.performance.summary.avgDuration.toFixed(2) + 'ms',
        totalMethods: results.performance.summary.totalMethods,
        exceptions: results.performance.summary.totalExceptions,
        dashboardURL: dashboardURL
      };

      const topSlowMethods = results.performance.slowMethods.slice(0, 5).map((m: any, i: number) =>
        `${m.method} (${m.class}): ${(m.avgDuration / 1000).toFixed(2)}ms avg`
      );

      const topBottlenecks = results.performance.bottlenecks.slice(0, 5).map((b: any, i: number) =>
        `${b.method} (${b.class}): Impact ${b.impactScore.toFixed(0)}`
      );

      const output = [
        `✅ Dashboard Analysis Complete`,
        ``,
        `📊 Summary:`,
        `   Total Calls: ${summary.totalCalls.toLocaleString()}`,
        `   Avg Duration: ${summary.avgDuration}`,
        `   Total Methods: ${summary.totalMethods}`,
        `   Exceptions: ${summary.exceptions}`,
        ``,
        `🐌 Top 5 Slow Methods:`,
        ...topSlowMethods.map((m: string, i: number) => `   ${i + 1}. ${m}`),
        ``,
        `🔴 Top 5 Bottlenecks:`,
        ...topBottlenecks.map((b: string, i: number) => `   ${i + 1}. ${b}`),
        ``,
        `🌐 View Full Dashboard: ${dashboardURL}`
      ].join('\n');

      return {
        content: [{
          type: 'text',
          text: output
        }]
      };
    }
  );

  mcp.tool(
    "dashboard.analyze",
    "Analyze a flowtrace.jsonl file and return performance metrics (no UI)",
    {
      path: z.string().describe("Absolute path to the flowtrace.jsonl log file to analyze for performance metrics"),
      top: z.number().optional().describe("Number of top slow methods and bottlenecks to return (default: 10)")
    },
    async ({ path: filePath, top = 10 }) => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      await ensureDashboardRunning();

      const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
        filePath: path.resolve(filePath)
      });

      const { results } = response.data;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: results.performance.summary,
            slowMethods: results.performance.slowMethods.slice(0, top),
            bottlenecks: results.performance.bottlenecks.slice(0, top),
            errorHotspots: results.performance.errorHotspots,
            timeDistribution: results.performance.timeDistribution
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool(
    "dashboard.bottlenecks",
    "Get performance bottlenecks from a flowtrace.jsonl file",
    {
      path: z.string().describe("Absolute path to the flowtrace.jsonl log file to analyze for performance bottlenecks"),
      top: z.number().optional().describe("Number of top bottlenecks to return, ranked by impact score (default: 10)")
    },
    async ({ path: filePath, top = 10 }) => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      await ensureDashboardRunning();

      const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
        filePath: path.resolve(filePath)
      });

      const bottlenecks = response.data.results.performance.bottlenecks.slice(0, top);

      const output = [
        `🔴 Top ${top} Performance Bottlenecks:`,
        ``,
        ...bottlenecks.map((b: any, i: number) => [
          `${i + 1}. ${b.method} (${b.class})`,
          `   Call Count: ${b.callCount.toLocaleString()}`,
          `   Avg Duration: ${(b.avgDuration / 1000).toFixed(2)}ms`,
          `   Total Time: ${(b.totalTime / 1000).toFixed(2)}ms`,
          `   Impact Score: ${b.impactScore.toFixed(0)}`,
          ``
        ].join('\n'))
      ].join('\n');

      return { content: [{ type: 'text', text: output }] };
    }
  );

  mcp.tool(
    "dashboard.errors",
    "Get error hotspots from a flowtrace.jsonl file",
    { path: z.string().describe("Absolute path to the flowtrace.jsonl log file to analyze for error hotspots and exception patterns") },
    async ({ path: filePath }) => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      await ensureDashboardRunning();

      const response = await axios.post(`${DASHBOARD_URL}/api/analyze-file`, {
        filePath: path.resolve(filePath)
      });

      const errors = response.data.results.performance.errorHotspots;

      if (errors.length === 0) {
        return { content: [{ type: 'text', text: '✅ No errors found in the log file!' }] };
      }

      const output = [
        `❌ Error Hotspots (${errors.length} methods with exceptions):`,
        ``,
        ...errors.map((e: any, i: number) => {
          const errorRate = (e.exceptions / e.callCount * 100).toFixed(2);
          return [
            `${i + 1}. ${e.method} (${e.class})`,
            `   Total Calls: ${e.callCount.toLocaleString()}`,
            `   Exceptions: ${e.exceptions}`,
            `   Error Rate: ${errorRate}%`,
            ``
          ].join('\n');
        })
      ].join('\n');

      return { content: [{ type: 'text', text: output }] };
    }
  );
}
