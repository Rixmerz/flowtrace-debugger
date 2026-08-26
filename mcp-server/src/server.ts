// FlowTrace v2 MCP server entry point. All tools operate on schema v2 events
// (see schema/flowtrace-v2.json). v1 logs are detected by the loader and v2
// tools fail soft (empty results + stderr warning).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import { loadJsonl } from "./lib/jsonl";
import { applyFilters } from "./filter";
import type { OpenSession, TraceEvent } from "./types";
import {
  traceTree,
  traceFindError,
  tracePrivateCalls,
  traceDiff,
} from "./trace-tools";

const mcp = new McpServer({ name: "flowtrace-mcp", version: "2.1.0" });

/**
 * Open sessions, newest-touched last.
 *
 * A session holds every parsed event of a trace in memory, and this server is
 * a long-lived stdio process: one debugging session can open a dozen traces,
 * and nothing ever released them. Capped and evicted least-recently-used.
 */
const sessions = new Map<string, OpenSession>();

/** Ids evicted to make room, so a stale id gets a useful error, not "invalid". */
const evicted = new Set<string>();

/** Ids explicitly released via log_close — distinguishes "closed on purpose"
 *  from "evicted for space" and from "never opened" (a typo). */
const closed = new Set<string>();

const MAX_SESSIONS = (() => {
  const raw = Number(process.env.FLOWTRACE_MCP_MAX_SESSIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
})();

function genId(): string { return Math.random().toString(36).slice(2); }

/** Drops least-recently-used sessions until the cap holds. */
function evictOverCap(): string[] {
  const dropped: string[] = [];
  while (sessions.size > MAX_SESSIONS) {
    // Map preserves insertion order and touch() reinserts, so the first key is
    // the least recently used.
    const oldest = sessions.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    sessions.delete(oldest);
    evicted.add(oldest);
    dropped.push(oldest);
  }
  return dropped;
}

function getSession(id: string): OpenSession {
  const s = sessions.get(id);
  if (!s) {
    if (closed.has(id)) {
      throw new Error(
        `Session ${id} was closed via log_close. Re-open the log with log_open.`
      );
    }
    if (evicted.has(id)) {
      throw new Error(
        `Session ${id} was evicted: at most ${MAX_SESSIONS} logs are kept open ` +
        `(raise FLOWTRACE_MCP_MAX_SESSIONS). Re-open the log with log_open.`
      );
    }
    throw new Error(`Invalid sessionId: ${id}`);
  }
  // Re-insert to move it to the most-recently-used end of the Map.
  s.lastUsed = Date.now();
  sessions.delete(id);
  sessions.set(id, s);
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
    sessions.set(id, {
      id, path, rows, fields, schemaVersion, malformed, lastUsed: Date.now(),
    });
    const dropped = evictOverCap();
    return ok({
      sessionId: id,
      count: rows.length,
      schemaVersion,
      malformed,
      // Reported rather than silent: a caller holding an older id needs to know
      // it just became unusable.
      ...(dropped.length ? { evictedSessions: dropped } : {}),
    });
  }
);

mcp.tool(
  "log_close",
  "Release a session and free the memory holding its events",
  { sessionId: z.string().describe("Session id from log_open") },
  async ({ sessionId }) => {
    const existed = sessions.delete(sessionId);
    if (existed) {
      evicted.delete(sessionId);
      closed.add(sessionId);
    }
    return ok({ closed: existed, openSessions: sessions.size });
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

const whereSchema = z.object({
  event: z.enum(["enter", "exit"]).optional().describe("Event variant"),
  method: z.string().optional().describe("Substring, case-insensitive"),
  class: z.string().optional().describe("Substring, case-insensitive"),
  module: z.string().optional().describe("Substring, case-insensitive"),
  lang: z.string().optional().describe("Substring, case-insensitive"),
  visibility: z.string().optional().describe("public | private | internal | unknown"),
  thread: z.string().optional().describe("Substring, case-insensitive"),
  trace_id: z.string().optional().describe("Exact match"),
  span_id: z.string().optional().describe("Exact match"),
  parent_id: z.string().optional().describe("Exact match"),
  has_error: z.boolean().optional().describe("true = only failing exits"),
  min_duration_ns: z.number().optional().describe("Implies exit events only"),
  max_duration_ns: z.number().optional().describe("Implies exit events only"),
  min_depth: z.number().int().optional(),
  max_depth: z.number().int().optional(),
}).describe("Field-level predicates, ANDed together");

mcp.tool(
  "log_search",
  "Filter v2 events by field (preferred) or free-text substring, with paging",
  {
    sessionId: z.string().describe("Session id from log_open"),
    where: whereSchema.optional().describe("Field-level filters — prefer these over `filter`"),
    filter: z.string().optional().describe("Case-sensitive substring matched against the whole serialized row. Broad: matches method, class, module and argument values alike. Prefer `where`."),
    fields: z.array(z.string()).optional().describe("Subset of fields to return"),
    limit: z.number().int().positive().optional().describe("Max rows (default 200)"),
    offset: z.number().int().nonnegative().optional().describe("Rows to skip, for paging through a large match set"),
  },
  async ({ sessionId, where, filter, fields, limit = 200, offset = 0 }) => {
    const s = getSession(sessionId);
    const matched = applyFilters(s.rows, where, filter);
    const page = matched.slice(offset, offset + limit);

    let rows: unknown[] = page;
    if (fields?.length) {
      rows = page.map(r => {
        const o: Record<string, unknown> = {};
        for (const f of fields) o[f] = (r as unknown as Record<string, unknown>)[f];
        return o;
      });
    }

    // The old shape was a bare array sliced to 200, so a caller could not tell
    // 12 matches from 12,000 — it saw the same 200 rows either way and had no
    // signal that it was reasoning about a fragment.
    return ok({
      total: matched.length,
      offset,
      returned: rows.length,
      truncated: offset + rows.length < matched.length,
      rows,
    });
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
    where: whereSchema.optional().describe("Field-level filters applied before aggregation"),
    filter: z.string().optional().describe("Optional substring filter applied before aggregation"),
  },
  async ({ sessionId, groupBy, metric, where, filter }) => {
    const s = getSession(sessionId);
    const rows = applyFilters(s.rows, where, filter);
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
    maxDepth: z.number().int().positive().optional().describe("Max depth (root = 0) to expand children for"),
    maxNodes: z.number().int().positive().optional().describe("Max total nodes to emit (default 2000)"),
  },
  async ({ sessionId, trace_id, maxDepth, maxNodes }) => {
    const s = getSession(sessionId);
    const events = v2OnlyEvents(s);
    const { roots, truncated, totalNodes } = traceTree(events, trace_id, { maxDepth, maxNodes });
    return ok({ trace_id, roots, truncated, totalNodes });
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
  "Compare two v2 sessions: methods only-in-A, only-in-B, and avg duration deltas grouped by module+class+method, ranked by absolute delta",
  {
    sessionId_a: z.string().describe("Baseline session id (A)"),
    sessionId_b: z.string().describe("Comparison session id (B)"),
    min_abs_delta_ns: z.number().nonnegative().optional().describe("Absolute duration-delta floor in ns; rows below it are excluded (default excludes sub-microsecond deltas)"),
  },
  async ({ sessionId_a, sessionId_b, min_abs_delta_ns }) => {
    const a = getSession(sessionId_a);
    const b = getSession(sessionId_b);
    return ok(traceDiff(v2OnlyEvents(a), v2OnlyEvents(b), { min_abs_delta_ns }));
  }
);

// -- entrypoint ------------------------------------------------------------

const transport = new StdioServerTransport();
void mcp.connect(transport);
