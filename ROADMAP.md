# Roadmap

What is being worked on, what is next, and what is deliberately not planned.

> This file was a v1 artifact until 2026-09: it listed Python and Go as "🔴 Not
> Started" while both were shipped and matrix-tested in CI, described the v2
> headline feature (W3C cross-process tracing) as a 2026 aspiration, and set
> quarter targets that had all expired. A roadmap that says the flagship
> feature does not exist is worse than no roadmap. It is now a short list keyed
> to reality; if it goes stale again, delete it rather than let it mislead.

## Shipped

The state of the world, so the rest of this file has a baseline. The
authoritative version is the `flowtrace://runtimes` MCP resource
(`mcp-server/src/runtimes.ts`) — this restates it.

| Capability | Where |
|---|---|
| Java capture (OTel javaagent extension, JDK 17/21/25 in CI) | `capture/java/` |
| Python capture (import hook + AST rewrite, 3.9/3.11/3.13 in CI) | `capture/python/` |
| Node + TypeScript capture (CJS hook, ESM loader, SWC/Babel transform) | `capture/node/` |
| Go capture (source rewrite via `go build -overlay`, 1.24/1.25 in CI) | `capture/go/` |
| Browser capture (HTTP, navigation, errors) | `capture/browser/` |
| Cross-process tracing over W3C Trace Context | every layer |
| Secret redaction and value truncation | every file-writing layer |
| MCP server (`log_*`, `trace_*`) and the Claude Code plugin | `mcp-server/`, `plugin/` |
| Dashboard (analysis UI + browser collector) | `flowtrace-dashboard/` |
| Golden fixtures as the regression net | `examples/golden/` |

## Now

- **Cross-layer field conformance.** `module`, `class`, `visibility` and
  `thread` still mean subtly different things per layer (`module` is a file
  basename in Node, an import path in Go, a package in Java). The golden
  fixtures cannot catch this: each is diffed against its own layer. The fix is
  to write the intended semantics into `schema/flowtrace-v2.json`'s
  `description` fields and add one fixture that runs the same program through
  every layer.
- **Java thread pools.** Virtual threads propagate context; tasks submitted to
  a platform-thread pool do not, and inherit whatever span was current when the
  pool thread started. Wrong parentage is worse than missing parentage.
  `capture/java/.../README.md` states this honestly meanwhile.

## Next

- **Nested-function instrumentation in Node**, behind a flag. Today the
  transform stops at the outermost function so an Express trace stays readable;
  Python instruments nested functions, so the same program produces differently
  shaped trees in the two layers.
- **Sampling / conditional capture** for high-traffic services. The current
  answer is the package prefix, which is a static filter.
- **Streaming reads in the MCP server.** Sessions hold the whole trace in
  memory, now with a byte cap; an index over the file would remove the cap.

## Not planned

- **Rust and .NET capture.** Both were v1 experiments, removed in v2. They
  emitted a different schema and nothing in the v2 pipeline can read their
  output. Reopening either means writing a new layer, not restoring one.
- **A `--schema-v1` compatibility mode.** Floated for 2.0.0, never built, not
  wanted three majors later. v1 logs still open and report `schemaVersion:
  "v1"`; the v2-only tools return empty rather than inventing structure.
- **Storage backends, retention policies, RBAC.** FlowTrace writes a file that
  a person or an agent reads. Anything that needs a database is a different
  product.

## Contributing to any of this

See [CONTRIBUTING.md](CONTRIBUTING.md). The highest-value contributions are
usually a golden fixture that pins behaviour nobody had pinned, and a fix to a
layer that disagrees with the other four.
