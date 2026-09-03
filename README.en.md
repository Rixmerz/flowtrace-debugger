# FlowTrace

[![v2-ci](https://github.com/Rixmerz/flowtrace-debugger/actions/workflows/v2-ci.yml/badge.svg)](https://github.com/Rixmerz/flowtrace-debugger/actions/workflows/v2-ci.yml)
[![npm](https://img.shields.io/npm/v/@rixmerz/flowtrace)](https://www.npmjs.com/package/@rixmerz/flowtrace)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

🇺🇸 English | [🇪🇸 Español](./README.md)

Zero-source-modification multi-language call tracer. Generates structured JSONL logs of every instrumented method, ready for AI analysis.

**Supported runtimes**: Java 11+ | Python 3.9+ | Node.js 20.6+ | TypeScript 5+ | Go 1.24+

Plus the **browser**, a separate and deliberately narrower layer: with no
`AsyncLocalStorage` there is no ambient async context, so it does not
instrument every function — it records HTTP, navigation and errors.

```bash
npm i @rixmerz/flowtrace-browser        # the browser only; everything else ships in the CLI
```

The MCP server's `flowtrace://runtimes` resource is the source of truth for
what FlowTrace supports; the above restates it. Where they ever disagree the
resource wins — an agent can read it rather than infer it.

---

## Quick install

```bash
npm install -g @rixmerz/flowtrace
```

Do not reach for `npx @rixmerz/flowtrace`: npm resolves its configuration from
the nearest `package.json` to the *current* directory, and `flowtrace run` is by
definition run from inside your project — so a project declaring
`devEngines.packageManager` makes npx fail with `EBADDEVENGINES`, in exactly the
projects this exists to trace. The Claude Code plugin puts `flowtrace` on PATH
without a global install (it installs into its own cache directory, for the
same reason).

`@rixmerz/flowtrace` is the **only** package you need for the five runtimes.
It carries the capture layers inside the tarball: no Maven, no pip, and no
`@flowtrace/capture-node` (that name does not exist on npm — it is a
workspace-internal package the CLI already vendors). The browser is the
exception: it installs separately, above.

---

## Quickstart

### Java
```bash
flowtrace run -- java -jar myapp.jar
```

### Python
```bash
flowtrace run -- python myapp.py
```

### Node.js / TypeScript
```bash
flowtrace run -- node myapp.js
# or with ts-node:
flowtrace run -- ts-node myapp.ts
```

### Go
```bash
flowtrace run -- go run ./cmd/api
# `go build` and `go test` work too
```
Requires Go 1.24+, and the target module's own `go` directive must be 1.24+ as
well. Instrumentation happens before compilation (via `go build -overlay`):
your source tree is never written to, not one byte.

### Where the trace lands

`flowtrace run` writes to `.flowtrace/<timestamp>.jsonl` in the working
directory and adds `.flowtrace/` to the project's `.gitignore`. It prints the
path on startup. `flowtrace.jsonl` is the default only when you wire a capture
layer by hand; every tool takes an explicit path.

---

## Distributed tracing (across processes)

The ids are W3C Trace Context compatible, so a trace survives a process hop:
one service propagates `traceparent` and the next adopts it instead of minting
a fresh trace. Both halves share one `trace_id` and read as a single tree.

| Runtime | Inbound (adopts the caller's trace) | Outbound (propagates to the next hop) |
|---|---|---|
| Java | Automatic — the OTel agent | Automatic within what OTel instruments |
| Node / TS | Automatic — the HTTP server edge is patched (express, fastify, koa, plain `http`) | Automatic — patches `fetch` and `http.request` |
| Go | Automatic — the transformer seeds every `func(http.ResponseWriter, *http.Request)` | Manual |
| Python | **`FLOWTRACE_TRACEPARENT` only** — an inbound HTTP header is not adopted on its own | Manual |

All four also read `FLOWTRACE_TRACEPARENT`, so chaining processes with no HTTP
in between is just a matter of exporting it before launching the child.

The **browser** is usually the origin of the chain rather than a hop in it: the
Angular interceptor attaches `traceparent` to every outgoing request, and
inbound means seeding the page with a server-rendered traceparent
(`initFlowtrace({ traceparent })`).

> **When the frontend and the API are on different origins**, `traceparent` is
> not CORS-safelisted, so adding it turns a simple request into a preflighted
> one. The API must answer with
> `Access-Control-Allow-Headers: Content-Type, traceparent` or **the request
> never happens**, and turning FlowTrace on looks like it broke the app.

Python needs the request wrapped by hand:

```python
from flowtrace_runtime import remote_context
with remote_context(request.headers.get("traceparent")):
    ...
```

That import only resolves under `flowtrace run`, so guard it with
`try/except ImportError` if the same code also runs uninstrumented.

Go needs nothing written for inbound, and you should **not** call `flowtracert`
from your own source: it exists only during an instrumented build, so importing
it would break your ordinary `go build`. Outbound is attached by hand from
already-instrumented code — there is no seam, since `net/http` resolves at
compile time.

### Verifying the chain actually joined

A split trace looks exactly like a working trace until you check the ids.
Collect each process's file and confirm they share one `trace_id`:

```bash
for f in */.flowtrace/*.jsonl; do
  echo "$f: $(jq -r .trace_id "$f" | sort -u | tr '\n' ' ')"
done
```

Two different ids mean a hop dropped the header. That is the finding.

---

## Output schema (JSONL v2)

Each line is a JSON object. See [docs/architecture.md](docs/architecture.md#schema-v2) for the full specification.

```json
{"ts":1715000000.123,"event":"enter","lang":"python","class":"OrderService","method":"create","trace_id":"abc","span_id":"def","parent_id":null,"depth":0}
{"ts":1715000000.456,"event":"exit","lang":"python","class":"OrderService","method":"create","result":{"id":42},"duration_ns":333000,"depth":0}
```

---

## AI integration (MCP server)

The MCP server exposes tools so AI agents can analyze traces directly:

| Tool | Description |
|---|---|
| `trace_tree` | Call tree for a trace |
| `trace_find_error` | Find the first exception in the log |
| `trace_private_calls` | List internal methods not exposed in the API |
| `trace_diff` | Compare two traces (before/after a change) |

It also serves the `flowtrace://runtimes` resource: supported runtimes, minimum
versions, how each is invoked, and what propagation each has. An agent reads
that instead of inferring capabilities from a README.

The supported way to run it is the Claude Code plugin, which ships it as a
single-file bundle:

```
/plugin marketplace add Rixmerz/flowtrace-debugger
/plugin install flowtrace@rixmerz-flowtrace
```

The plugin also puts `flowtrace` on the PATH, so `flowtrace run -- ...` works
with no global install.

---

## Dashboard

```bash
cd flowtrace-dashboard && npm start
# http://localhost:8765   (FLOWTRACE_DASHBOARD_PORT to change it)
```

It binds `127.0.0.1` only, and reads traces only from the directory it was
started in (plus `FLOWTRACE_DASHBOARD_ROOTS`). There is no authentication: this
is a local tool, and a trace routinely contains arguments and return values.

See [flowtrace-dashboard/](flowtrace-dashboard/) for full instructions.

---

## Migration from v1

If you use v1 logs (`ENTER`/`EXIT`, `durationMicros`), see:

[docs/migration-v1-v2.md](docs/migration-v1-v2.md)

---

## Development

Prerequisites: Node ≥ 20.6, pnpm 9.15.4 (`corepack enable`), JDK 21+, Maven 3.9+,
Python ≥ 3.9, Go ≥ 1.24. The first Java test downloads ~24 MB (the OTel agent,
verified against a pinned sha256).

```bash
pnpm install
make test          # everything; this is the source of truth
```

After touching…               | run
---                           | ---
`mcp-server/src`              | `make bundle-mcp`
`flowtrace-dashboard/`        | `make bundle-dashboard`
a capture layer               | `make gen-golden` — and **review the diff**
`mcp-server/src/runtimes.ts`  | `make check-docs`

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE)
