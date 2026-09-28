# Threat model

What FlowTrace protects, from whom, and where the lines are. `SECURITY.md`
says how to report a problem and lists the concrete mitigations; this file
says why those are the mitigations, so a change can be checked against the
reasoning rather than against a list.

## What FlowTrace is

A developer tool that runs **on the developer's own machine, against their own
code**. It rewrites or instruments that code, records the arguments and return
values of its functions into a JSONL file, and lets tools (CLI, dashboard, MCP
server, an AI agent) read the file.

It is not a production observability backend. Nothing in it is designed to be
exposed to a network or to users other than the one who ran it.

## Assets

| Asset | Why it matters |
|---|---|
| **Trace contents** (`args`, `result`, `error.msg`, stacks) | Real values from a running program: credentials, personal data, tokens. The file exists to be pasted into a model conversation. |
| **Rewritten-code caches** (`~/.flowtrace/cache/`) | Loaded and executed by every traced Node / Python process. |
| **The OTel javaagent** (`~/.flowtrace/`) | Runs before the application's `main()` with full privileges. |
| **Files readable by the dashboard** | The dashboard reads paths it is given. |

## Trust boundaries

1. **Developer → capture layer.** Trusted: the developer chose to instrument
   their program. The capture layer is exactly as trusted as that program.
2. **Capture layer → trace file.** The boundary where data *leaves* the
   program. Everything on the far side is less protected than the process.
3. **Trace file → reader (CLI, dashboard, MCP server, agent).** Readers must
   treat the file as untrusted input: it may be hand-edited, truncated, or
   come from someone else's machine.
4. **Trace file → third party** (an issue, a model provider, an OTLP
   backend). The data has left the machine; nothing FlowTrace does afterwards
   can recall it.
5. **Dashboard HTTP surface → anything that can reach it.** Unauthenticated.

## Threats and responses

### T1. Secrets leave the machine inside a trace (boundaries 2, 4)

The most likely harm, and the reason redaction exists.

- Key-based redaction at capture time (`password`, `token`, …; extended by
  `FLOWTRACE_REDACT_KEYS`). Catches values by *name* only.
- `flowtrace anonymize` hashes **every** value regardless of key, keeping
  equality (keyed HMAC, random salt by default so short values cannot be
  brute-forced from the hash). Strips stack frames, which name files.
- `flowtrace export` sends to an endpoint only when `--endpoint` is given
  explicitly, only over `http(s)`, and says in its docs to anonymize first.
- **Residual:** a secret under an innocuous name (`arg0`, a URL path segment)
  survives redaction. Only `anonymize` or reading the file removes it.

### T2. Code execution through the rewrite caches (boundary 1)

- Cache directories `0700`, files `0600`; the Go layer stages overlays in a
  private temporary directory and never writes to the source tree.
- **Residual:** anyone who already runs as the developer's user can write
  there — but they could equally edit the source.

### T3. A tampered javaagent (boundary 1)

- Download verified against a pinned SHA-256; mismatches are discarded;
  redirects followed to `https` only.

### T4. Hostile trace file (boundary 3)

A trace is parsed by the MCP server inside an agent session and by the
dashboard in a browser.

- The MCP server caps file size (`FLOWTRACE_MCP_MAX_BYTES`) and open sessions,
  bounds every list response (`total` / `truncated`), walks trees iteratively
  or to call depth only, and never writes to stdout outside the protocol.
- `read_skill` serves only embedded strings keyed by name — no filesystem
  path is derived from the argument.
- The dashboard renders with a strict CSP and no CDN scripts.
- **Residual — prompt injection:** a string value in a trace is attacker-
  controllable (it is whatever the program received). An agent reading
  `args` through the MCP tools may read instructions planted there. Tools
  return trace data as JSON data, never as instructions, and the analysis
  playbooks treat values as evidence; the agent still has to.

### T5. Dashboard reached by someone else (boundary 5)

- Binds `127.0.0.1` unless `FLOWTRACE_DASHBOARD_HOST` widens it (with a
  warning); reads only inside allowed roots resolved through `realpath`;
  uploads get server-chosen names and a size cap.
- **Residual:** no authentication. Widening the bind address without an
  authenticating proxy in front exposes every readable trace.

## Out of scope

- An attacker who already controls the developer's account.
- Production deployment of any component.
- Confidentiality of traces after the developer shares them (T1 is about
  making sharing safer, not about controlling it afterwards).
