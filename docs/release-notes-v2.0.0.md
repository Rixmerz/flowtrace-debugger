# FlowTrace v2.0.0 Release Notes

**Zero-source-modification capture for Java, Python, Node.js, and TypeScript.**

---

## Highlights

- **4 capture mechanisms** — OTel extension (Java), `sys.setprofile` (Python), `Module._load` patch (Node.js/CJS), `--experimental-loader` hook (Node.js/ESM). None require modifying user source code.
- **OTel-compatible W3C trace IDs** — every span carries a `trace_id` (32 hex) and `span_id` (16 hex) compatible with OpenTelemetry collectors, Jaeger, and Zipkin.
- **MCP server tools for AI agents** — `trace.tree`, `trace.find_error`, `trace.private_calls`, `trace.diff` let AI assistants reason over traces without writing custom parsers.
- **Slim CLI** — three commands: `init`, `run`, `analyze`. No install/update/status commands.
- **Schema v2** — typed fields, snake_case, objects instead of serialized strings. See [migration guide](migration-v1-v2.md).

---

## Breaking changes

- **Schema v2** is not backward-compatible with v1 logs. The MCP server includes a v1-compat shim that detects and translates on the fly, but v2-only tools return empty results for v1 logs.
- **CLI commands trimmed**: `install`, `update`, `status` removed. Use `npm`/package manager directly.
- **`--` separator required** before the user command in `flowtrace run`.
- **Capture agents relocated** to `capture/<lang>/`. The v1 agents were kept in
  `legacy/` at the time of this release and have since been deleted.

Full field-by-field diff: [migration-v1-v2.md](migration-v1-v2.md)

---

## Go, Rust, .NET

These runtimes are not part of the v2 capture layer. Their v1 agents shipped
alongside this release in `legacy/`; they have since been deleted and no
migration is planned. FlowTrace covers Java, Node/TypeScript and Python.

---

## Acknowledgments

v1 laid the foundation: ByteBuddy bytecode rewrite for Java, AST rewrite for Go, proc-macro for Rust, Source Generator for .NET. v2 builds on that experience and replaces the intrusive approaches with lighter, zero-modification hooks for the four highest-demand runtimes.
