# FlowTrace Architecture

> Reference for contributors and integrators. For sprint history see [HANDOFF_V2.md](../HANDOFF_V2.md).

---

## Three-layer model

```
L1 Capture  —  language-specific instrumentation (agent per runtime)
     |
     v  JSONL events (schema v2)
L2 Adapter  —  normalisation, filtering, buffering, flush to disk
     |
     v  flowtrace.jsonl
L3 Consumer —  MCP server, dashboard, CLI analyzer
```

### L1 — Capture

Each runtime uses its native hook point:

| Runtime | Mechanism |
|---|---|
| Java | OpenTelemetry Java agent extension. `SpanProcessor` intercepts every span at `onStart`/`onEnd`. No bytecode rewrite at the user level. |
| Python | A `sys.meta_path` finder (`FlowtraceFinder`) installs a loader that rewrites each matching module's AST at import time, injecting enter/exit calls. Compiled results are cached by content hash under `~/.flowtrace/cache/py`. |
| Node.js | An ESM loader registered via `module.register()` (Node 20.6+), plus a CJS `require` hook, rewriting each matching module's AST as it loads. |
| TypeScript | The same Node.js loaders — TypeScript is transformed on the same path, not a separate mechanism. |
| Go | No runtime hook exists, so rewriting happens *before* the compiler: `go list -json` enumerates packages, each matching file is byte-spliced at AST offsets, and the result reaches the compiler through `go build -overlay`. The runtime is injected as `<module>/internal/flowtracert`, a package the compiler sees but the disk never holds — the user's tree is never written to. Requires Go 1.24+. |

Capture agents live in `capture/<lang>/`. The v1 agents have been deleted — see
"Removed runtimes" in `migration-v1-v2.md`.

### L2 — Adapter

Shared responsibilities across all agents:
- Apply package/module prefix filter (scope to user code; without this, logs explode).
- Truncate `args`/`result` to `max-arg-length` bytes (see `TRUNCATION_SYSTEM.md`).
- Assign W3C-compatible `trace_id` (32 hex chars) and `span_id` (16 hex chars) per call stack.
- Write one JSON line per event to `flowtrace.jsonl` via a line-buffered writer.

### L3 — Consumer

| Consumer | Entry point | Description |
|---|---|---|
| MCP server | `mcp-server/src/server.ts` | Exposes log analysis tools via stdio MCP transport. |
| Dashboard | `flowtrace-dashboard/server/server.js` | Express + static UI; `/api/*` routes call analyzer. |
| CLI analyzer | `analyze-logs.sh` | Shell helper that summarizes a JSONL file. |

---

## Schema v2

Every agent emits one JSON object per line. Field names are stable — renaming any field requires coordinated changes across all agents and consumers.

```
ts            float   Unix timestamp in seconds (float, microsecond precision)
event         string  "enter" | "exit"
lang          string  "java" | "python" | "node" | "ts" | "go"
class         string  Class or module name
method        string  Method or function name
module        string  File path or package (optional, L1-dependent)
trace_id      string  W3C-compatible 32-hex trace identifier
span_id       string  W3C-compatible 16-hex span identifier
parent_id     string  span_id of the caller, null for root
depth         int     Call stack depth (0 = root)
visibility    string  "public" | "private" | "protected" (where detectable)
args          object  Parsed argument map (truncated per max-arg-length)
result        object  Return value (exit events only, truncated)
duration_ns   int     Wall-clock duration in nanoseconds (exit events only)
error         object  Exception info if method threw (exit events only)
```

EXIT events always pair with an ENTER event sharing the same `span_id`.

---

## Decisions log

**Why OpenTelemetry extension for Java (not ByteBuddy direct rewrite)?**
ByteBuddy direct rewrite (v1 approach) required a premain agent and class matching by annotation. OTel extension builds on a production-grade instrumentation framework, provides W3C context propagation for free, and avoids conflicts with other Java agents the user may run. Trade-off: requires the OTel Java agent as a carrier, adding ~10 MB to the classpath.

**Why `sys.setprofile` for Python (not AST rewrite)?**
AST rewrite (Go approach) modifies source before compilation. For Python, `sys.setprofile` is zero-modification and works with any import, including C extensions at the Python boundary. It cannot trace into C extensions themselves; AST rewrite cannot either, so the trade-off is symmetric. `setprofile` is simpler to maintain and does not require a build step.

**Why in-body wrap (not IIFE) for Node.js?**
An IIFE wrapper around the entire module body would change the module's `this` binding and break CommonJS modules that rely on `exports` being set before the wrap executes. Per-export function wrapping at `Module._load` time preserves semantics.

**Why two JSONL lines per Java span (enter + exit)?**
A single "completed span" line would require buffering the entire call subtree in memory before flushing. Two lines (enter then exit) allow streaming writes with constant memory per in-flight call. Consumers correlate pairs via `span_id`.

**Why W3C trace IDs over UUIDs?**
W3C `traceparent` format (`trace_id` 32 hex, `span_id` 16 hex) is compatible with OpenTelemetry collectors and Jaeger/Zipkin importers. Users can forward FlowTrace logs to an OTel backend without field transformation.
