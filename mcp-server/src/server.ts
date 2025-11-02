import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { loadJsonl } from "./lib/jsonl";
import type { LogEvent } from "./types";
import { registerDashboardTools } from "./dashboard-tools";
import { registerFlowTraceTools } from "./flowtrace-tools";

const mcp = new McpServer({ name: "flowtrace-mcp", version: "0.1.0" });

const sessions = new Map<string, { rows: LogEvent[]; fields: Record<string, number>; path: string }>();
function genId() { return Math.random().toString(36).slice(2); }

mcp.tool("log.open", "Open a JSONL log and return session id", {
  path: z.string().describe("Absolute path to the JSONL log file to open and create an analysis session")
}, async ({ path }) => {
  if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
  const { rows, fields } = await loadJsonl(path);
  const id = genId();
  sessions.set(id, { rows, fields, path });
  return { content: [{ type: 'text', text: JSON.stringify({ sessionId: id, count: rows.length }) }] };
});

mcp.tool("log.schema", "Return discovered fields and a sample row", {
  sessionId: z.string().describe("Session ID returned from log.open, used to identify the active log session")
}, async ({ sessionId }) => {
  const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
  return { content: [{ type: 'text', text: JSON.stringify({ fields: s.fields, sampleRow: s.rows[0] ?? null }) }] };
});

mcp.tool(
  "log.search",
  "Filter rows by mini-DSL and return selected fields",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Filter string - returns rows where JSON representation contains this substring (case-sensitive)"),
    fields: z.array(z.string()).optional().describe("Array of field names to return in results. If not specified, returns all fields"),
    limit: z.number().optional().describe("Maximum number of rows to return (default: 200)"),
    sort: z.string().optional().describe("Field name to sort results by (alphabetical/lexical order)")
  },
  async ({ sessionId, filter, fields, limit = 200, sort }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    // trivial predicate: if filter given, do simple contains on JSON string; (full DSL can be wired later)
    let rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    if (sort) rows = rows.sort((a,b)=>String((a as any)[sort]).localeCompare(String((b as any)[sort])));
    if (fields?.length) rows = rows.map(r => Object.fromEntries(fields.map(f => [f, (r as any)[f]])) as any);
    return { content: [{ type: 'text', text: JSON.stringify(rows.slice(0, limit)) }] };
  }
);

// Register dashboard tools
registerDashboardTools(mcp);

// Register FlowTrace initialization and execution tools
registerFlowTraceTools(mcp);

const transport = new StdioServerTransport();
(async () => { await mcp.connect(transport); })();


mcp.tool(
  "log.aggregate",
  "Group && aggregate metrics over fields",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    groupBy: z.array(z.string()).describe("Array of field names to group results by (creates composite key from all fields)"),
    metric: z.object({
      op: z.enum(["count","sum","avg","max","min"]).describe("Aggregation operation: 'count' (row count), 'sum', 'avg', 'max', 'min' (all require numeric field)"),
      field: z.string().optional().describe("Field name to aggregate (required for sum/avg/max/min, ignored for count)")
    }).describe("Aggregation metric to calculate: {op: 'count'|'sum'|'avg'|'max'|'min', field?: string}"),
    filter: z.string().optional().describe("Filter string - only aggregate rows where JSON representation contains this substring")
  },
  async ({ sessionId, groupBy, metric, filter }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    let rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    const grouped = new Map<string, any[]>();
    for (const r of rows) {
      const key = groupBy.map(k => String((r as any)[k])).join('|');
      grouped.set(key, [...(grouped.get(key)||[]), r]);
    }
    const out: any[] = [];
    for (const [k, rs] of grouped) {
      const nums = metric.field ? rs.map(r => Number((r as any)[metric.field!])).filter(n => !Number.isNaN(n)) : [];
      let value: any;
      if (metric.op === "count") value = rs.length;
      else if (metric.op === "sum") value = nums.length ? nums.reduce((a,b) => a+b, 0) : 0;
      else if (metric.op === "avg") value = nums.length ? (nums.reduce((a,b) => a+b, 0) / nums.length) : 0;
      else if (metric.op === "max") value = nums.length ? Math.max(...nums) : undefined;
      else if (metric.op === "min") value = nums.length ? Math.min(...nums) : undefined;
      out.push({ key: k, value: value });
    }
    return { content: [{ type:'text', text: JSON.stringify(out) }] };
  }
);

mcp.tool(
  "log.topK",
  "Top K values for a field",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    byField: z.string().describe("Field name to count occurrences and rank by frequency"),
    k: z.number().optional().describe("Number of top values to return (default: 20)"),
    filter: z.string().optional().describe("Filter string - only count rows where JSON representation contains this substring")
  },
  async ({ sessionId, byField, k = 20, filter }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    const counts = new Map<string, number>();
    for (const r of s.rows.filter(r => !filter || JSON.stringify(r).includes(filter))) {
      const v = String((r as any)[byField]);
      counts.set(v, (counts.get(v)||0) + 1);
    }
    const arr = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([value,count])=>({value,count}));
    return { content: [{ type:'text', text: JSON.stringify(arr) }] };
  }
);

mcp.tool(
  "log.timeline",
  "Ordered events matching a filter",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Filter string - only return events where JSON representation contains this substring"),
    fields: z.array(z.string()).optional().describe("Array of field names to return. If not specified, returns all fields")
  },
  async ({ sessionId, filter, fields }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    let rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter)).sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));
    if (fields?.length) rows = rows.map(r=>Object.fromEntries(fields.map(f=>[f,(r as any)[f]])) as any);
    return { content: [{ type:'text', text: JSON.stringify(rows) }] };
  }
);

mcp.tool(
  "log.flow",
  "Build correlation chains by keys",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    keys: z.array(z.string()).describe("Array of field names to use as correlation keys (creates composite key from all fields to track related events)")
  },
  async ({ sessionId, keys }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    const map = new Map<string, any[]>();
    for (const r of s.rows) {
      const k = keys.map(k => String((r as any)[k] ?? '')).join('|');
      if (!k.replace(/\|/g,'')) continue;
      map.set(k, [...(map.get(k)||[]), r]);
    }
    const list = Array.from(map.entries()).map(([key,events])=>({ key, count: events.length, first: events[0]?.timestamp, last: events[events.length-1]?.timestamp }));
    return { content: [{ type:'text', text: JSON.stringify(list) }] };
  }
);

mcp.tool(
  "log.errors",
  "List likely error events by regex on standard fields",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Additional filter string applied before error detection (substring match on JSON)")
  },
  async ({ sessionId, filter }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    const rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    const hits = rows.filter(r => /(error|exception|fail|500|NOK)/i.test(String((r as any).result ?? '')));
    return { content: [{ type:'text', text: JSON.stringify(hits.slice(0,500)) }] };
  }
);

mcp.tool(
  "log.sample",
  "Sample rows matching a filter",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Filter string - only sample rows where JSON representation contains this substring"),
    limit: z.number().optional().describe("Number of sample rows to return (default: 50)")
  },
  async ({ sessionId, filter, limit = 50 }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    const rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter)).slice(0, limit);
    return { content: [{ type:'text', text: JSON.stringify(rows) }] };
  }
);

mcp.tool(
  "log.export",
  "Export filtered rows to CSV || JSON",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Filter string - only export rows where JSON representation contains this substring"),
    fields: z.array(z.string()).optional().describe("Array of field names to export. If not specified, exports all fields"),
    to: z.enum(["csv","json"]).describe("Export format: 'csv' (comma-separated values) or 'json' (JSON array)")
  },
  async ({ sessionId, filter, fields, to }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    let rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));
    if (fields?.length) rows = rows.map(r=>Object.fromEntries(fields.map(f=>[f,(r as any)[f]])) as any);
    if (to === 'json') return { content: [{ type:'text', text: JSON.stringify(rows) }] };
    const cols = fields && fields.length ? fields : Object.keys(rows[0] || {});
    const lines = [cols.join(',')];
    for (const r of rows) {
      lines.push(cols.map(c => JSON.stringify((r as any)[c] !== undefined ? (r as any)[c] : "")).join(','));
    }
    return { content: [{ type:'text', text: lines.join('\n') }] };
  }
);

mcp.tool(
  "log.expand",
  "Expand truncated log by retrieving full data from segmented file",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    timestamp: z.number().describe("Exact timestamp of the log entry to expand (must match a row's timestamp field)"),
    event: z.string().optional().describe("Optional event name to disambiguate if multiple entries share the same timestamp")
  },
  async ({ sessionId, timestamp, event }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");

    // Find log entry by timestamp
    const logEntry = s.rows.find(r => r.timestamp === timestamp && (!event || r.event === event));
    if (!logEntry) throw new Error(`Log entry not found: timestamp=${timestamp}, event=${event}`);

    // Check if it has truncated fields
    if (!logEntry.truncatedFields || !logEntry.fullLogFile) {
      return { content: [{ type: 'text', text: JSON.stringify({
        message: "Log entry is not truncated",
        data: logEntry
      }) }] };
    }

    // Read full log from segmented file
    const segmentedFilePath = logEntry.fullLogFile as string;
    const basePath = s.path.substring(0, s.path.lastIndexOf('/') + 1);
    const fullPath = basePath + segmentedFilePath;

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Segmented file not found: ${fullPath}`);
    }

    const fullData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

    return { content: [{ type: 'text', text: JSON.stringify({
      truncatedLog: logEntry,
      fullLog: fullData,
      truncatedFields: logEntry.truncatedFields,
      message: "Full log data retrieved successfully"
    }) }] };
  }
);

mcp.tool(
  "log.searchExpanded",
  "Search logs with automatic expansion of truncated entries",
  {
    sessionId: z.string().describe("Session ID returned from log.open"),
    filter: z.string().optional().describe("Filter string - returns rows where JSON representation contains this substring"),
    fields: z.array(z.string()).optional().describe("Array of field names to return. If not specified, returns all fields"),
    limit: z.number().optional().describe("Maximum number of rows to return (default: 200)"),
    autoExpand: z.boolean().optional().describe("Automatically expand truncated log entries by reading segmented files (default: false)")
  },
  async ({ sessionId, filter, fields, limit = 200, autoExpand = false }) => {
    const s = sessions.get(sessionId); if (!s) throw new Error("Invalid sessionId");
    let rows = s.rows.filter(r => !filter || JSON.stringify(r).includes(filter));

    if (autoExpand) {
      const basePath = s.path.substring(0, s.path.lastIndexOf('/') + 1);

      // Expand truncated logs
      rows = rows.map(row => {
        if (row.truncatedFields && row.fullLogFile) {
          try {
            const fullPath = basePath + row.fullLogFile;
            if (fs.existsSync(fullPath)) {
              const fullData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
              return { ...row, _expandedData: fullData };
            }
          } catch (err) {
            console.error(`Failed to expand log: ${err}`);
          }
        }
        return row;
      });
    }

    if (fields?.length) rows = rows.map(r => Object.fromEntries(fields.map(f => [f, (r as any)[f]])) as any);
    return { content: [{ type: 'text', text: JSON.stringify(rows.slice(0, limit)) }] };
  }
);
