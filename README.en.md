# FlowTrace

🇺🇸 English | [🇪🇸 Español](./README.md)

Zero-source-modification multi-language call tracer. Generates structured JSONL logs of every instrumented method, ready for AI analysis.

**Supported runtimes**: Java 11+ | Python 3.8+ | Node.js 18+ | TypeScript 5+

---

## Quick install

```bash
npm install -g @flowtrace/cli
```

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

Logs are written to `flowtrace.jsonl` in the working directory.

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
| `trace.tree` | Call tree for a trace |
| `trace.find_error` | Find the first exception in the log |
| `trace.private_calls` | List internal methods not exposed in the API |
| `trace.diff` | Compare two traces (before/after a change) |

```bash
npx @flowtrace/mcp-server
```

Point your IDE at this server and AI agents will be able to analyze logs automatically.

---

## Dashboard

```bash
cd flowtrace-dashboard && npm start
# http://localhost:3000
```

See [flowtrace-dashboard/](flowtrace-dashboard/) for full instructions.

---

## Migration from v1

If you use v1 logs (`ENTER`/`EXIT`, `durationMicros`), see:

[docs/migration-v1-v2.md](docs/migration-v1-v2.md)

---

## License

MIT — see [LICENSE](LICENSE)
