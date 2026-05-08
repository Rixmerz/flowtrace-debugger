# Migration Guide: v1 to v2

This document covers breaking changes between FlowTrace schema v1 and v2, and how to update consumers and tooling.

---

## Field rename table

| v1 field | v2 field | Notes |
|---|---|---|
| `timestamp` (int ms) | `ts` (float seconds) | Divide v1 value by 1000 to convert. Microsecond precision preserved as fractional seconds. |
| `event: "ENTER"` | `event: "enter"` | Lowercase. |
| `event: "EXIT"` | `event: "exit"` | Lowercase. |
| `class` | `class` | Unchanged. |
| `method` | `method` | Unchanged. |
| `args` (JSON string) | `args` (object) | v1 stored a serialized JSON string; v2 stores the parsed object directly. |
| `result` (JSON string) | `result` (object) | Same as args: was a string, now an object. |
| `durationMicros` | `duration_ns` | Multiply v1 value by 1000 to convert to nanoseconds. |
| `durationMillis` | `duration_ns` | Multiply v1 value by 1,000,000. |
| _(absent)_ | `trace_id` | W3C-compatible 32-hex trace identifier. |
| _(absent)_ | `span_id` | W3C-compatible 16-hex span identifier. |
| _(absent)_ | `parent_id` | `span_id` of caller; null for root. |
| _(absent)_ | `lang` | Runtime: `"java"`, `"python"`, `"node"`, `"typescript"`. |
| _(absent)_ | `module` | File path or package (L1-dependent, may be absent). |
| _(absent)_ | `visibility` | `"public"` / `"private"` / `"protected"` where detectable. |
| _(absent)_ | `depth` | Call stack depth (0 = root). |
| _(absent)_ | `error` | Exception info on exit events where the method threw. |

---

## MCP server v1-compat shim

The `mcp-server` includes a compatibility shim that detects v1 logs by checking whether the first event contains `"event":"ENTER"` or `"timestamp"` (integer).

- On v1 log detection: the server logs a warning to stderr and translates fields on the fly for `log_open`, `log_search`, and `log_aggregate`.
- v2-only tools (`trace_tree`, `trace_diff`, `trace_private_calls`) return an empty result set for v1 logs with an explanatory message.

To silence the warning and opt into v1 mode explicitly, pass `--schema-v1` to `flowtrace analyze` (planned for 3 releases, not yet implemented).

---

## Capture-layer breaking changes

| Change | Detail |
|---|---|
| Agent location | v1 agents moved to `legacy/v1/`. Do not use them for new instrumentation. |
| New capture path | `capture/<lang>/` — one directory per runtime. |
| Java entry point | v1: `flowtrace-agent/` (ByteBuddy premain). v2: `capture/java/flowtrace-otel-extension/` (OTel extension). |
| Python entry point | v1: `agents/python/`. v2: `capture/python/`. |
| Node entry point | v1: `flowtrace-agent-js/`. v2: `capture/node/`. |

---

## CLI command changes

| v1 command | v2 equivalent | Notes |
|---|---|---|
| `flowtrace install` | removed | Installation is now `npm install -g @flowtrace/cli`. |
| `flowtrace update` | removed | Use `npm update -g @flowtrace/cli`. |
| `flowtrace status` | removed | Check `flowtrace.jsonl` directly. |
| `flowtrace init` | `flowtrace init` | Retained; detects runtime and writes config. |
| `flowtrace run` | `flowtrace run -- <cmd>` | `--` separator now required before the user command. |
| `flowtrace analyze` | `flowtrace analyze` | Retained; accepts `--schema-v1` flag (future). |

---

## Go, Rust, .NET

Go, Rust, and .NET agents are not part of the v2 capture layer. They remain in `legacy/v1/` and continue to emit v1 schema logs. Support will be ported to v2 in a future sprint.
