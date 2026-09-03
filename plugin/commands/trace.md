---
name: trace
description: Run a command under FlowTrace instrumentation and report what it captured. Detects the project language and wires the right capture layer.
argument-hint: "[command to run, e.g. python app.py]"
---

Run **$ARGUMENTS** under FlowTrace and report the resulting trace.

If no command was given, detect how this project is normally run and propose
one before doing anything.

## Steps

1. **Detect the language** from what is present: `pom.xml` / `build.gradle` →
   Java; `pyproject.toml` / `setup.py` / `requirements.txt` → Python;
   `package.json` → Node, plus `tsconfig.json` → TypeScript; `go.mod` → Go.

2. **Determine the package prefix** — the scope of instrumentation. Without one
   the capture instruments frameworks and stdlib and the trace becomes
   unreadable, so this is not optional:
   - Java: `groupId` from `pom.xml`, or `group` from `build.gradle`
   - Python: `name` from `pyproject.toml` / `setup.py`
   - Node/TS: `name` from `package.json` (drop any `@scope/`)
   - Go: the `module` line from `go.mod` (Go needs 1.24 or newer, and the
     target module's own `go` directive must be 1.24+ too — FlowTrace refuses
     before touching anything otherwise, rather than failing mid-build)

   State the prefix you chose. If detection is ambiguous, ask rather than guess —
   a wrong prefix produces an empty trace that looks like a bug in the code.

3. **Run it** with `flowtrace run -- $ARGUMENTS`.

   The plugin ships `flowtrace` on your PATH, so this resolves with no global
   install. The shim installs the pinned CLI version into its own cache
   directory (`$XDG_CACHE_HOME/flowtrace-cli/<version>`) on first use and runs
   it from there. It deliberately does NOT use `npx`: npm resolves its
   configuration from the nearest `package.json` to the current directory, and
   this command runs inside the user's project — so a project declaring
   `devEngines.packageManager` makes `npx @rixmerz/flowtrace` fail with
   `EBADDEVENGINES`, in exactly the projects tracing is wanted for. If
   `flowtrace` is somehow not resolvable, tell the user to
   `npm i -g @rixmerz/flowtrace`; do not suggest npx.

   `@rixmerz/flowtrace` is the package that vendors every capture layer. The
   one other published package is `@rixmerz/flowtrace-browser`, which is a
   build-time dependency of a front-end bundle and is not involved here. Do NOT try to install `@flowtrace/cli` or
   `@flowtrace/capture-node` — those names are not on npm and never have been;
   they are workspace-internal. Do not hand-wire a capture layer, and do not
   symlink one out of a flowtrace-debugger checkout: that only works on the
   machine that happens to have it, which is how a repo ends up with an
   instrumentation setup CI cannot reproduce.

   Read the `flowtrace://runtimes` MCP resource if you need to confirm what is
   supported. It is authoritative; any doc that disagrees with it is stale.

4. **Report**, do not dump:
   - How many events, across how many `trace_id`s
   - The call tree of the primary trace, at a readable depth
   - Anything anomalous: an `enter` with no `exit` (the process died inside that
     call), truncated arguments, or zero events

**If the trace is empty**, that is almost always the prefix — check it before
concluding anything about the application. Report the prefix you used and what
you would try instead.

## Tracing across processes

For a chain of services, one `trace_id` should span every hop — otherwise you
can show each hop is clean without showing the chain is. The ids are W3C Trace
Context compatible, so this works:

- **Java** propagates both ways on its own (the OTel agent).
- **Node / TypeScript** propagate both ways on their own — the HTTP server edge
  and `fetch` / `http.request` are both patched.
- **Go** adopts an inbound header on its own: the transformer seeds every
  `func(http.ResponseWriter, *http.Request)`. Outbound is manual. Never tell
  the user to call `flowtracert` from their own source — it exists only during
  an instrumented build, so importing it breaks their plain `go build`.
- **Python** does **not** adopt an inbound header on its own. It must be
  wrapped in `flowtrace_runtime.remote_context(header)` by hand, and that
  import only resolves under `flowtrace run`.

When there is no HTTP between the processes, export
`FLOWTRACE_TRACEPARENT=00-<32 hex trace>-<16 hex span>-01` before launching the
child; every runtime reads it.

Check `flowtrace://runtimes` rather than trusting this list — it is generated
from one source and this is a restatement.

To verify a chain really joined: collect each process's trace and check they
share one `trace_id`, then `trace_tree` it. Two different trace_ids means a hop
dropped the header — that is the finding, not a reason to report success per
hop.

---

Leave the trace in place for follow-up analysis and mention its path.
`flowtrace run` writes `.flowtrace/<timestamp>.jsonl` in the working directory
(it prints the path on startup) — not `flowtrace.jsonl`, which is only the
default when a capture layer is wired by hand.
