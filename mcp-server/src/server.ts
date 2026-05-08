// FlowTrace v2 MCP server entry point. All tools operate on schema v2 events
// (see schema/flowtrace-v2.json). v1 logs are detected by the loader and v2
// tools fail soft (empty results + stderr warning).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import { loadJsonl } from "./lib/jsonl";
import type { OpenSession, TraceEvent } from "./types";
import {
  traceTree,
  traceFindError,
  tracePrivateCalls,
  traceDiff,
} from "./trace-tools";

const mcp = new McpServer({ name: "flowtrace-mcp", version: "2.0.0" });

const sessions = new Map<string, OpenSession>();
function genId(): string { return Math.random().toString(36).slice(2); }
function getSession(id: string): OpenSession {
  const s = sessions.get(id);
  if (!s) throw new Error(`Invalid sessionId: ${id}`);
  return s;
}
function v2OnlyEvents(s: OpenSession): TraceEvent[] {
  return s.schemaVersion === "v2" ? s.rows : [];
}
function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

// -- log_* tools (v2-aware) ------------------------------------------------

mcp.tool(
  "log_open",
  "Open a v2 JSONL trace log and return a session id",
  { path: z.string().describe("Absolute path to the JSONL log file") },
  async ({ path }) => {
    if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
    const { rows, fields, schemaVersion, malformed } = await loadJsonl(path);
    const id = genId();
    sessions.set(id, { id, path, rows, fields, schemaVersion, malformed });
    return ok({ sessionId: id, count: rows.length, schemaVersion, malformed });
  }
);

mcp.tool(
  "log_schema",
  "Return discovered fields and a sample row for a v2 session",
  { sessionId: z.string().describe("Session id from log_open") },
  async ({ sessionId }) => {
    const s = getSession(sessionId);
    return ok({
      schemaVersion: s.schemaVersion,
      fields: s.fields,
      sampleRow: s.rows[0] ?? null,
    });
  }
);

mcp.tool(
  "log_search",
  "Filter v2 events by substring and return selected fields",
  {
    sessionId: z.string().describe("Session id from log_open"),
    filter: z.string().optional().describe("Case-sensitive substring matched against the JSON form of each row"),
    fields: z.array(z.string()).optional().describe("Subset of fields to return"),
    limit: z.number().int().positive().optional().describe("Max rows (default 200)"),
  },
  async ({ sessionId, filter, fields, limit = 200 }) => {
    const s = getSession(sessionId);
    let rows: unknown[] = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    if (fields?.length) {
      rows = (rows as TraceEvent[]).map(r => {
        const o: Record<string, unknown> = {};
        for (const f of fields) o[f] = (r as unknown as Record<string, unknown>)[f];
        return o;
      });
    }
    return ok(rows.slice(0, limit));
  }
);

mcp.tool(
  "log_aggregate",
  "Group v2 events by fields and aggregate (count/sum/avg/max/min)",
  {
    sessionId: z.string().describe("Session id from log_open"),
    groupBy: z.array(z.string()).describe("Field names that form the composite group key"),
    metric: z.object({
      op: z.enum(["count", "sum", "avg", "max", "min"]).describe("Aggregation operator"),
      field: z.string().optional().describe("Numeric field for sum/avg/max/min"),
    }),
    filter: z.string().optional().describe("Optional substring filter applied before aggregation"),
  },
  async ({ sessionId, groupBy, metric, filter }) => {
    const s = getSession(sessionId);
    const rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    const grouped = new Map<string, number[]>();
    for (const r of rows) {
      const rec = r as unknown as Record<string, unknown>;
      const key = groupBy.map(k => String(rec[k] ?? "")).join("|");
      const v = metric.field ? Number(rec[metric.field]) : 1;
      const arr = grouped.get(key) ?? [];
      arr.push(Number.isFinite(v) ? v : 0);
      grouped.set(key, arr);
    }
    const out: Array<{ key: string; value: number; n: number }> = [];
    for (const [key, vals] of grouped) {
      let value = 0;
      if (metric.op === "count") value = vals.length;
      else if (metric.op === "sum") value = vals.reduce((a, b) => a + b, 0);
      else if (metric.op === "avg") value = vals.reduce((a, b) => a + b, 0) / vals.length;
      else if (metric.op === "max") value = Math.max(...vals);
      else if (metric.op === "min") value = Math.min(...vals);
      out.push({ key, value, n: vals.length });
    }
    return ok(out);
  }
);

// -- trace_* tools ---------------------------------------------------------

mcp.tool(
  "trace_tree",
  "Build a hierarchical call tree for a given trace_id from a v2 session",
  {
    sessionId: z.string().describe("Session id from log_open"),
    trace_id: z.string().describe("W3C trace id (32 hex chars) to scope the tree"),
  },
  async ({ sessionId, trace_id }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    return ok({ trace_id, roots: traceTree(events, trace_id) });
  }
);

mcp.tool(
  "trace_find_error",
  "Find the first error event in a v2 session and return its call path to root",
  { sessionId: z.string().describe("Session id from log_open") },
  async ({ sessionId }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    const result = traceFindError(events);
    return ok(result ?? { error: null });
  }
);

mcp.tool(
  "trace_private_calls",
  "List private-visibility methods called in a v2 session, grouped by class.method",
  { sessionId: z.string().describe("Session id from log_open") },
  async ({ sessionId }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    return ok({ private_calls: tracePrivateCalls(events) });
  }
);

mcp.tool(
  "trace_diff",
  "Compare two v2 sessions: methods only-in-A, only-in-B, and avg duration deltas > 20%",
  {
    sessionId_a: z.string().describe("Baseline session id (A)"),
    sessionId_b: z.string().describe("Comparison session id (B)"),
  },
  async ({ sessionId_a, sessionId_b }) => {
    const a = getSession(sessionId_a);
    const b = getSession(sessionId_b);
    return ok(traceDiff(v2OnlyEvents(a), v2OnlyEvents(b)));
  }
);

// -- entrypoint ------------------------------------------------------------

const transport = new StdioServerTransport();
void mcp.connect(transport);
