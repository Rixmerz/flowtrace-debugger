# @flowtrace/mcp-server

MCP server that answers questions about a `flowtrace.jsonl` v2 trace.

Transport is **stdio**, so nothing may ever be written to stdout outside the
MCP protocol itself. Diagnostics go to stderr.

## How it ships

You almost certainly do not need to run this directly. The FlowTrace Claude Code
plugin bundles it: `plugin/mcp/server.bundle.js` is a committed, single-file
esbuild build with every dependency inlined, and installing the plugin registers
it automatically. See `plugin/README.md`.

For development in this repo:

```bash
make build-mcp     # tsc -> dist/
make test-mcp      # build + run the tool tests
make bundle-mcp    # rebuild the bundle the plugin ships (required after src changes)
```

## Tools

A log is loaded once per `log.open` and held in an in-memory session keyed by
the returned `sessionId`; every other tool takes that id.

| Tool | Purpose |
|------|---------|
| `log.open` | Load a JSONL trace, return `sessionId`, event count and detected schema version |
| `log.close` | Release a session and free its events |
| `log.schema` | Discovered fields plus one sample row |
| `log.search` | Filter events by field (`where`) or free text, with paging |
| `log.aggregate` | Group and count / sum over a field, with the same `where` |
| `trace.tree` | Rebuild the call tree for one `trace_id` from `parent_id` links |
| `trace.find_error` | First failing call, with the path from the root down to it |
| `trace.private_calls` | Calls whose `visibility` is not public — what the public API did internally |
| `trace.diff` | Compare two traces: calls only in one, and duration deltas |

`trace.find_error` looks for an `exit` event carrying a top-level `error`.
Schema v2 has no `event: "error"` variant.

### Filtering

Prefer `where` over `filter`. `filter` is a substring test against the whole
serialized row, so `"user"` matches a method `getUser`, a class `UserService`,
a module path and any argument value alike — noise that costs context without
narrowing anything. `where` scopes the match to a field:

```json
{"where": {"method": "save", "has_error": true, "min_duration_ns": 1000000}}
```

Predicates are ANDed. Ids (`trace_id`, `span_id`, `parent_id`) match exactly;
other strings match case-insensitive substrings. A duration or depth range
implies `exit` events only, since only those carry the field.

`log.search` returns `{total, offset, returned, truncated, rows}` — `total` is
the full match count, so a truncated page is visible as such rather than
looking like the whole answer.

### Session lifetime

Each session holds the entire parsed trace in memory. At most
`FLOWTRACE_MCP_MAX_SESSIONS` (default 8) are kept; opening past the cap evicts
the least recently used and names it in `evictedSessions`. Using an evicted id
returns an error saying so and how to recover. `log.close` releases one
explicitly.

## v1 logs

`src/v1-compat.ts` detects the pre-2.0 format (`timestamp` in milliseconds,
uppercase `ENTER`/`EXIT`, no `trace_id`) and marks the session so the v2 tools
return empty rather than misinterpreting the fields. v1 logs are not supported —
the detection exists only to fail clearly instead of silently.
