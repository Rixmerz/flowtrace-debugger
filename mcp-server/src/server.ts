// FlowTrace v2 MCP server entry point. All tools operate on schema v2 events
// (see schema/flowtrace-v2.json). v1 logs are detected by the loader and v2
// tools fail soft (empty results + stderr warning).
//
// Built on fastmcp.

import { FastMCP } from "fastmcp";
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

const server = new FastMCP({ name: "flowtrace-mcp", version: "2.0.0" });

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

// -- log_* tools (v2-aware) ------------------------------------------------

server.addTool({
  name: "log_open",
  description: "Open a v2 JSONL trace log and return a session id",
  parameters: z.object({
    path: z.string().describe("Absolute path to the JSONL log file"),
  }),
  execute: async ({ path }) => {
    if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
    const { rows, fields, schemaVersion, malformed } = await loadJsonl(path);
    const id = genId();
    sessions.set(id, { id, path, rows, fields, schemaVersion, malformed });
    return JSON.stringify({ sessionId: id, count: rows.length, schemaVersion, malformed });
  },
});

server.addTool({
  name: "log_schema",
  description: "Return discovered fields and a sample row for a v2 session",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
  }),
  execute: async ({ sessionId }) => {
    const s = getSession(sessionId);
    return JSON.stringify({
      schemaVersion: s.schemaVersion,
      fields: s.fields,
      sampleRow: s.rows[0] ?? null,
    });
  },
});

server.addTool({
  name: "log_search",
  description: "Filter v2 events by substring and return selected fields",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
    filter: z.string().optional().describe("Case-sensitive substring matched against the JSON form of each row"),
    fields: z.array(z.string()).optional().describe("Subset of fields to return"),
    limit: z.number().int().positive().optional().describe("Max rows (default 200)"),
  }),
  execute: async ({ sessionId, filter, fields, limit = 200 }) => {
    const s = getSession(sessionId);
    let rows: unknown[] = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    if (fields?.length) {
      rows = (rows as TraceEvent[]).map(r => {
        const o: Record<string, unknown> = {};
        for (const f of fields) o[f] = (r as unknown as Record<string, unknown>)[f];
        return o;
      });
    }
    return JSON.stringify(rows.slice(0, limit));
  },
});

server.addTool({
  name: "log_aggregate",
  description: "Group v2 events by fields and aggregate (count/sum/avg/max/min)",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
    groupBy: z.array(z.string()).describe("Field names that form the composite group key"),
    metric: z.object({
      op: z.enum(["count", "sum", "avg", "max", "min"]).describe("Aggregation operator"),
      field: z.string().optional().describe("Numeric field for sum/avg/max/min"),
    }),
    filter: z.string().optional().describe("Optional substring filter applied before aggregation"),
  }),
  execute: async ({ sessionId, groupBy, metric, filter }) => {
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
    return JSON.stringify(out);
  },
});

// -- trace_* tools ---------------------------------------------------------

server.addTool({
  name: "trace_tree",
  description: "Build a hierarchical call tree for a given trace_id from a v2 session",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
    trace_id: z.string().describe("W3C trace id (32 hex chars) to scope the tree"),
  }),
  execute: async ({ sessionId, trace_id }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    return JSON.stringify({ trace_id, roots: traceTree(events, trace_id) });
  },
});

server.addTool({
  name: "trace_find_error",
  description: "Find the first error event in a v2 session and return its call path to root",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
  }),
  execute: async ({ sessionId }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    const result = traceFindError(events);
    return JSON.stringify(result ?? { error: null });
  },
});

server.addTool({
  name: "trace_private_calls",
  description: "List private-visibility methods called in a v2 session, grouped by class.method",
  parameters: z.object({
    sessionId: z.string().describe("Session id from log_open"),
  }),
  execute: async ({ sessionId }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    return JSON.stringify({ private_calls: tracePrivateCalls(events) });
  },
});

server.addTool({
  name: "trace_diff",
  description: "Compare two v2 sessions: methods only-in-A, only-in-B, and avg duration deltas > 20%",
  parameters: z.object({
    sessionId_a: z.string().describe("Baseline session id (A)"),
    sessionId_b: z.string().describe("Comparison session id (B)"),
  }),
  execute: async ({ sessionId_a, sessionId_b }) => {
    const a = getSession(sessionId_a);
    const b = getSession(sessionId_b);
    return JSON.stringify(traceDiff(v2OnlyEvents(a), v2OnlyEvents(b)));
  },
});

// -- entrypoint ------------------------------------------------------------

void server.start({ transportType: "stdio" });
