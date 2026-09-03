// FlowTrace v2 MCP server entry point. All tools operate on schema v2 events
// (see schema/flowtrace-v2.json). v1 logs are detected by the loader and v2
// tools fail soft (empty results + stderr warning).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loadJsonl } from "./lib/jsonl";
import { applyFilters } from "./filter";
import type { OpenSession, TraceEvent } from "./types";
import {
  traceTree,
  traceFindError,
  tracePrivateCalls,
  traceDiff,
} from "./trace-tools";
import { renderRuntimes } from "./runtimes";

const mcp = new McpServer({ name: "flowtrace-mcp", version: "2.2.0" });

/**
 * Open sessions, newest-touched last.
 *
 * A session holds every parsed event of a trace in memory, and this server is
 * a long-lived stdio process: one debugging session can open a dozen traces,
 * and nothing ever released them. Capped and evicted least-recently-used.
 */
const sessions = new Map<string, OpenSession>();

/**
 * A bounded set of ids: the newest MAX_REMEMBERED_IDS are kept and older ones
 * forgotten. These exist only to turn "invalid session" into a useful message,
 * so remembering every id a long-lived process ever issued was an unbounded
 * leak in service of a nicety.
 */
const MAX_REMEMBERED_IDS = 1000;
class RecentIds {
  private ids = new Set<string>();
  add(id: string) {
    this.ids.add(id);
    while (this.ids.size > MAX_REMEMBERED_IDS) {
      const oldest = this.ids.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.ids.delete(oldest);
    }
  }
  has(id: string) { return this.ids.has(id); }
  delete(id: string) { return this.ids.delete(id); }
}

/** Ids evicted to make room, so a stale id gets a useful error, not "invalid". */
const evicted = new RecentIds();

/** Ids explicitly released via log_close — distinguishes "closed on purpose"
 *  from "evicted for space" and from "never opened" (a typo). */
const closed = new RecentIds();

const MAX_SESSIONS = (() => {
  const raw = Number(process.env.FLOWTRACE_MCP_MAX_SESSIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
})();

/**
 * Largest log this server will load. Every event is retained as a JS object,
 * so a multi-hundred-MB JSONL becomes several times that in heap and takes the
 * process down with it — an out-of-memory kill of an MCP server reads to the
 * agent as "the tool disappeared", with nothing to explain it.
 */
const MAX_BYTES = (() => {
  const raw = Number(process.env.FLOWTRACE_MCP_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 512 * 1024 * 1024;
})();

function genId(): string { return randomUUID(); }

/**
 * Rejects a field name the session has never seen, naming the closest ones it
 * has. A typo used to be silent: the row lookup produced `undefined`, so
 * log_search returned a column of nulls and log_aggregate grouped everything
 * under one empty key — both of which read as a finding about the program.
 */
function assertKnownFields(s: OpenSession, names: string[], what: string): void {
  const known = Object.keys(s.fields);
  const unknown = names.filter((n) => !(n in s.fields));
  if (unknown.length === 0) return;
  const near = (bad: string) => {
    const b = bad.toLowerCase();
    return known
      .filter((k) => k.toLowerCase().includes(b) || b.includes(k.toLowerCase()))
      .slice(0, 5);
  };
  const details = unknown
    .map((u) => {
      const suggestions = near(u);
      return suggestions.length ? `${u} (did you mean ${suggestions.join(", ")}?)` : u;
    })
    .join("; ");
  throw new Error(
    `Unknown ${what}: ${details}. This log has: ${known.join(", ")}`
  );
}

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
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path);
    } catch {
      throw new Error(`File not found: ${path}`);
    }
    if (stat.isDirectory()) {
      throw new Error(
        `${path} is a directory, not a trace file. Point log_open at a .jsonl file inside it.`
      );
    }
    if (!stat.isFile()) throw new Error(`${path} is not a regular file`);
    if (stat.size > MAX_BYTES) {
      throw new Error(
        `${path} is ${stat.size} bytes, over the ${MAX_BYTES}-byte limit — the whole log is held in memory. ` +
        `Raise FLOWTRACE_MCP_MAX_BYTES to load it anyway, or narrow the capture (a package prefix usually shrinks a trace by an order of magnitude).`
      );
    }
    const { rows, fields, schemaVersion, malformed } = await loadJsonl(path);
    const id = genId();
    sessions.set(id, {
      id, path, rows, fields, schemaVersion, malformed, lastUsed: Date.now(),
    });
    const dropped = evictOverCap();
    return ok({
      sessionId: id,
      count: rows.length,
      bytes: stat.size,
      fields: Object.keys(fields),
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
    if (fields?.length) assertKnownFields(s, fields, "field name(s)");
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
    limit: z.number().int().positive().optional().describe("Max groups (default 200)"),
    offset: z.number().int().nonnegative().optional().describe("Groups to skip, for paging"),
  },
  async ({ sessionId, groupBy, metric, where, filter, limit = 200, offset = 0 }) => {
    const s = getSession(sessionId);
    assertKnownFields(s, groupBy, "groupBy field(s)");
    if (metric.field) assertKnownFields(s, [metric.field], "metric field");
    const rows = applyFilters(s.rows, where, filter);

    // Running accumulators rather than an array per group: `Math.max(...vals)`
    // spreads the group into an argument list, and a group the size of a real
    // trace overflows the call stack — on the most ordinary call this tool has.
    interface Acc { n: number; sum: number; max: number; min: number }
    const grouped = new Map<string, Acc>();
    for (const r of rows) {
      const rec = r as unknown as Record<string, unknown>;
      const key = groupBy.map(k => String(rec[k] ?? "")).join("|");
      const raw = metric.field ? Number(rec[metric.field]) : 1;
      const v = Number.isFinite(raw) ? raw : 0;
      let acc = grouped.get(key);
      if (!acc) {
        acc = { n: 0, sum: 0, max: -Infinity, min: Infinity };
        grouped.set(key, acc);
      }
      acc.n += 1;
      acc.sum += v;
      if (v > acc.max) acc.max = v;
      if (v < acc.min) acc.min = v;
    }

    const all: Array<{ key: string; value: number; n: number }> = [];
    for (const [key, acc] of grouped) {
      let value = 0;
      if (metric.op === "count") value = acc.n;
      else if (metric.op === "sum") value = acc.sum;
      else if (metric.op === "avg") value = acc.sum / acc.n;
      else if (metric.op === "max") value = acc.n ? acc.max : 0;
      else if (metric.op === "min") value = acc.n ? acc.min : 0;
      all.push({ key, value, n: acc.n });
    }
    // Deterministic order, so paging cannot skip or repeat a group.
    all.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    const groups = all.slice(offset, offset + limit);
    return ok({
      total: all.length,
      offset,
      returned: groups.length,
      truncated: offset + groups.length < all.length,
      groups,
    });
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

// -- resources -------------------------------------------------------------

// What FlowTrace actually supports, queryable rather than inferred. An agent
// that reads a README gets whichever of them it happened to open; this is the
// one answer. See src/runtimes.ts for why it exists.
mcp.resource(
  "runtimes",
  "flowtrace://runtimes",
  {
    description:
      "Authoritative list of runtimes FlowTrace can instrument: minimum versions, how each is invoked, where the package prefix comes from, cross-process propagation support, and which npm package is real. Read this before telling a user whether their language is supported.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderRuntimes() }],
  })
);

// -- entrypoint ------------------------------------------------------------

const transport = new StdioServerTransport();
void mcp.connect(transport);
