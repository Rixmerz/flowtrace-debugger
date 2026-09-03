# FlowTrace Architecture

> Reference for contributors and integrators. For sprint history see [HANDOFF_V2.md](./HANDOFF_V2.md).

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
| Java | An *extension* loaded by the OpenTelemetry javaagent. `FlowtraceTypeInstrumentation` selects methods and `FlowtraceAdvice` is woven into them by ByteBuddy — this **is** a bytecode rewrite; what the OTel agent provides is the carrier and the W3C context, not the weaving. There is no `SpanProcessor` anywhere in `capture/java`. |
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
- Write one JSON line per event via a line-buffered writer. Through the CLI the destination is `.flowtrace/<timestamp>.jsonl` in the working directory; `flowtrace.jsonl` is the layer default when wired by hand.

### L3 — Consumer

| Consumer | Entry point | Description |
|---|---|---|
| MCP server | `mcp-server/src/server.ts` | Exposes log analysis tools via stdio MCP transport. |
| Dashboard | `flowtrace-dashboard/server/server.js` | Express + static UI; `/api/*` routes call analyzer. |
| CLI analyzer | `flowtrace-cli/lib/commands/analyze.js` | `flowtrace analyze` — summarizes a trace and auto-loads the most recent one. |

---

## Cross-process propagation

`trace_id` / `span_id` are W3C Trace Context ids, so one logical request keeps a
single `trace_id` across a process hop and both halves read as one tree. This is
asserted end to end by `capture/node/test/test-cross-process.mjs`, which spawns
two real processes — it cannot be a golden fixture, because the golden
normalizer rewrites every `trace_id` to one constant and a fixture would look
identical whether or not correlation happened. Verified by hand on a
browser -> Node -> Java -> Go chain: all three service traces carried the
browser's `trace_id`.

| Runtime | Inbound | Outbound | Where it is implemented |
|---|---|---|---|
| Java | automatic | automatic within what the OTel agent instruments | the OTel agent, plus `TraceparentSeed` for the env carrier |
| Node / TS | automatic | automatic | `propagate.js` — patches `http.Server.prototype.emit` inbound, and `fetch` / `http.request` / `https.request` outbound |
| Go | automatic for `func(http.ResponseWriter, *http.Request)` | manual | `transform/` injects the seed; `flowtracert.CurrentTraceparent()` for outbound |
| Python | **env carrier only** | manual | `bootstrap.py` seeds from env; `remote_context` / `current_traceparent` are manual |

Every runtime additionally reads `FLOWTRACE_TRACEPARENT`, which is the carrier
for a process launched by another rather than called over HTTP.

**Why inbound is patched rather than documented.** `runWithRemoteContext`
(Node), `remote_context` (Python) and `SeedFromTraceparent` (Go) all existed
before any of them was reachable. `@flowtrace/capture-node` is not published;
under `flowtrace run` the Node runtime lives inside the CLI tarball at a
version-pinned vendor path; and Go's `flowtracert` is injected as
`<module>/internal/flowtracert`, so a handler importing it compiles under
`flowtrace run` and **breaks the user's ordinary `go build`**. "Call this in
your handler" was advice nobody could follow, and the failure was silent: every
service started a fresh trace per request, which looks exactly like a working
trace until you compare ids across processes. Node is patched at
`http.Server.prototype.emit` because that is the single choke point every
framework arrives through; Go is seeded by the transformer, which can recognise
the handler signature without the user writing anything.

Python is the remaining gap. It has no equivalent single choke point — WSGI,
ASGI and `http.server` are three unrelated entry shapes — so its header path is
still a manual `remote_context` call, and the docs say so rather than implying
parity.

**Why Go does not propagate outbound automatically.** Node can patch
`globalThis.fetch` and `http.request` at runtime because they are mutable
bindings on a live module object. Go resolves `net/http` at compile time; the
equivalent would mean rewriting stdlib call sites inside the `-overlay` pass —
transforming code the user did not write, in a package FlowTrace does not own,
to inject a header the caller may already be setting. That is a much larger
blast radius than the inbound half.

A synthetic remote parent is seeded at depth -1 in Node and Go so the first
*local* span lands at depth 0, matching an ordinary root and satisfying the
schema's `depth >= 0`. No event is ever emitted for the seed; the remote process
already emitted it. Python diverges deliberately — its `current_depth` holds the
depth of the span *about to start*, so it seeds 0 for the same effect.

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
visibility    string  "public" | "private" | "internal" | "unknown" (schema enum; Java maps protected -> internal)
args          object  Parsed argument map (truncated per max-arg-length)
result        object  Return value (exit events only, truncated)
duration_ns   int     Wall-clock enter->exit in nanoseconds (exit events only).
                      Covers the children the span WAITED for, not every child:
                      a span that starts async work without awaiting it closes
                      first, so a child's duration can exceed its parent's and
                      self-time can come out negative. That is a finding (the
                      parent handed work off), not corrupt data.
error         object  Exception info if method threw (exit events only)
```

EXIT events always pair with an ENTER event sharing the same `span_id`.

---

## Decisions log

**Why an OpenTelemetry extension for Java (not our own premain agent)?**
Both approaches weave bytecode with ByteBuddy — the question was only what carries the weaving. v1 shipped a standalone premain agent and matched classes by annotation, which meant owning agent startup, class-file transformation ordering, and conflicts with any other Java agent the user runs. An OTel extension inherits a production-grade instrumentation framework and W3C context propagation for free, and coexists with the agents users already have. Trade-off: it requires the OTel javaagent as a carrier (~24 MB, fetched once and checksum-verified).

**Why AST rewrite for Python (not `sys.setprofile`)?**
`sys.setprofile` fires on every call in the process, so scoping to user code means filtering at event time — after paying the cost — and it is a single global slot that a profiler, debugger or coverage tool will take from us. Rewriting the AST at import time means the instrumentation only exists in modules matching the prefix, and nothing is filtered on the hot path. `capture/python/transformer.py` is the implementation; there is no `setprofile` path.

*(This entry previously claimed the opposite. It described a design that was never shipped.)*

**Why in-body wrap (not IIFE) for Node.js?**
An IIFE wrapper around the entire module body would change the module's `this` binding and break CommonJS modules that rely on `exports` being set before the wrap executes. Per-export function wrapping at `Module._load` time preserves semantics.

**Why two JSONL lines per Java span (enter + exit)?**
A single "completed span" line would require buffering the entire call subtree in memory before flushing. Two lines (enter then exit) allow streaming writes with constant memory per in-flight call. Consumers correlate pairs via `span_id`.

**Why W3C trace IDs over UUIDs?**
W3C `traceparent` format (`trace_id` 32 hex, `span_id` 16 hex) is compatible with OpenTelemetry collectors and Jaeger/Zipkin importers. Users can forward FlowTrace logs to an OTel backend without field transformation.
