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

A log is loaded once per `log_open` and held in an in-memory session keyed by
the returned `sessionId`; every other tool takes that id.

| Tool | Purpose |
|------|---------|
| `log_open` | Load a JSONL trace, return `sessionId`, event count, byte size, field names and detected schema version |
| `log_close` | Release a session and free its events |
| `log_schema` | Discovered fields plus one sample row |
| `log_search` | Filter events by field (`where`) or free text, with paging |
| `log_aggregate` | Group and count / sum / avg / max / min over a field, with the same `where`, paged |
| `trace_tree` | Rebuild the call tree for one `trace_id` from `parent_id` links |
| `trace_find_error` | First failing call, with the path from the root down to it |
| `trace_private_calls` | Calls whose `visibility` is not public — what the public API did internally |
| `trace_diff` | Compare two traces: calls only in one, and duration deltas |

`trace_find_error` looks for an `exit` event carrying a top-level `error`.
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

`log_search` returns `{total, offset, returned, truncated, rows}` — `total` is
the full match count, so a truncated page is visible as such rather than
looking like the whole answer. `log_aggregate` returns the same envelope around
`groups`, ordered by value then key so paging cannot skip or repeat a group.

A field name that the open log does not have is an error naming the closest
ones it does, for both `fields` and `groupBy`. A typo used to be silent: the
lookup produced `undefined`, so a search returned a column of nulls and an
aggregation grouped everything under one empty key — results that read as a
finding about the traced program rather than a mistake in the query.

### Session lifetime and limits

Each session holds the entire parsed trace in memory.

| Variable | Default | Meaning |
|---|---|---|
| `FLOWTRACE_MCP_MAX_SESSIONS` | 8 | Sessions kept open. Opening past the cap evicts the least recently used and names it in `evictedSessions`. |
| `FLOWTRACE_MCP_MAX_BYTES` | 536870912 (512 MB) | Largest log `log_open` will load. Over it, the call fails with the size and this variable's name rather than taking the process down with an out-of-memory kill — which reaches the agent as "the tool disappeared", with nothing to explain it. |

Using an evicted id returns an error saying so and how to recover. `log_close`
releases one explicitly. `log_open` also refuses a directory and a path that
does not exist, each with its own message.

## v1 logs

`src/v1-compat.ts` detects the pre-2.0 format (`timestamp` in milliseconds,
uppercase `ENTER`/`EXIT`, no `trace_id`) and marks the session so the v2 tools
return empty rather than misinterpreting the fields. v1 logs are not supported —
the detection exists only to fail clearly instead of silently.
