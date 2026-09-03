# @rixmerz/flowtrace

Trace what your program actually did — Java, Python, Node, TypeScript and Go —
and read the result with an AI agent instead of guessing from source.

```bash
npm i -g @rixmerz/flowtrace

flowtrace run -- python app.py
flowtrace run -- node server.js
flowtrace run -- java -jar app.jar
flowtrace run -- go run ./cmd/api      # go build and go test work too
```

That is the whole setup. **No Maven, no pip, no clone.**

| Runtime | Minimum | Notes |
|---|---|---|
| Java | 11+ (CI covers JDK 17, 21, 25) | An OpenTelemetry javaagent extension, fetched and checksum-verified on first Java use |
| Python | 3.9+ | `sitecustomize` bootstrap + import hook; nothing to `pip install` |
| Node.js | 20.6+ | `module.register()` landed there; below it the CLI refuses rather than tracing nothing |
| TypeScript | 5+ on Node 20.6+ | Same loaders as Node; events carry `lang: "ts"` |
| Go | 1.24+ | Source rewrite before compilation via `go build -overlay`. **Your tree is never written to**, and you must never `import` `flowtracert` yourself — it only exists during an instrumented build, so importing it breaks a plain `go build`. |

## Why one package

The capture layers ship inside this package: the Python runtime as plain `.py`
files placed on `PYTHONPATH` (it needs no installation at all), the Node, Go
and browser layers as source, and the Java extension as its shaded jar. One `npm i`
therefore installs every runtime's capture at once, and — more importantly —
they can never drift out of version with each other, which matters because all
of them lock to the same trace schema.

The one thing not bundled is the OpenTelemetry javaagent: it is ~24 MB and not
ours, so it is downloaded on first Java use and cached in `~/.flowtrace/`. If
you never trace Java, it is never fetched. That jar is handed to the JVM as
`-javaagent:`, so it runs before your `main()` — the download is verified
against a pinned SHA-256 before it is put in place, and a mismatch is discarded
rather than loaded.

The browser is a separate package, `@rixmerz/flowtrace-browser`: it is a
build-time dependency of your own bundle, and no global CLI install can inject
a module into someone's bundler graph.

## Commands

| Command | Purpose |
|---------|---------|
| `flowtrace init` | Detect the project type and write `.flowtrace/config.json` |
| `flowtrace run -- <cmd>` | Run a command under instrumentation |
| `flowtrace analyze` | Open the trace in the dashboard |

`run` auto-detects the language and the package prefix, and honours what
`init` wrote to `.flowtrace/config.json` (`capture.packagePrefix`,
`capture.maxArgLength`). Precedence is flag > config > detection.

The prefix matters more than it sounds, since without one every framework and
stdlib call lands in the trace. What it matches depends on the runtime: a
package/module name in Java, Python and Go (`com.acme`, `myapp`,
`github.com/acme/svc`), and a **path** in Node and TypeScript, where the layer
tests it against the file's path.

Output goes to `.flowtrace/<timestamp>.jsonl` — one JSON object per line,
schema `flowtrace-v2`.

## Reading the trace

The [FlowTrace Claude Code plugin](https://github.com/Rixmerz/flowtrace-debugger/tree/main/plugin)
gives an agent `log_*` and `trace_*` tools over the file, plus a skill that
teaches it what the fields mean. Without it the trace is still plain JSONL —
`jq` works fine:

```bash
jq -s 'map(select(.event=="exit")) | sort_by(-.duration_ns) | .[:10]' .flowtrace/*.jsonl
```

## Configuration

| Variable | Effect |
|----------|--------|
| `FLOWTRACE_PACKAGE_PREFIX` | Restrict instrumentation to matching modules |
| `FLOWTRACE_MAX_ARG_LENGTH` | Truncate args/results (`0` disables, default 512) |
| `FLOWTRACE_REDACT_KEYS` | Comma-separated substrings ADDED to the built-in redact-key list (`password,secret,token,authorization,api_key,url,dsn,connection_string,email`); matched case-insensitively against argument names, at any nesting depth |
| `FLOWTRACE_TRACEPARENT` | Continue a trace started by another process |
| `FLOWTRACE_CACHE_DIR` | Where the OTel agent is cached (default `~/.flowtrace`) |
| `FLOWTRACE_PROPAGATE=0` | Disable automatic outgoing trace propagation |

## Cross-process tracing

The ids are W3C Trace Context compatible, so one request keeps a single
`trace_id` across a process hop. Not every hop is automatic, and a split trace
looks exactly like a healthy one until you compare ids:

| Runtime | Inbound (adopts the caller's trace) | Outbound (propagates onward) |
|---|---|---|
| Java | automatic (OTel), plus `FLOWTRACE_TRACEPARENT` | automatic across what the OTel agent instruments |
| Node / TS | automatic (the HTTP server edge is patched), plus `FLOWTRACE_TRACEPARENT` | automatic (`fetch`, `http`/`https`, child processes, workers) |
| Go | automatic for `func(http.ResponseWriter, *http.Request)`, plus `FLOWTRACE_TRACEPARENT` | **manual**, and only from instrumented code — `net/http` resolves at compile time, so there is no seam to patch |
| Python | `FLOWTRACE_TRACEPARENT` only — an inbound HTTP header is **not** adopted on its own; wrap the request in `flowtrace_runtime.remote_context(header)` | **manual** — `flowtrace_runtime.current_traceparent()` |

## Developing

From a checkout the CLI resolves the capture layers from `capture/` instead of
its vendored copies, so your edits take effect with no flag and no reinstall.

```bash
make build            # build every capture layer
npm run vendor        # copy them into vendor/ as a publish would
npm pack              # runs vendor automatically via prepack
```

MIT.
