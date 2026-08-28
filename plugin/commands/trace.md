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

3. **Run it** with `flowtrace run -- $ARGUMENTS` if the CLI is installed.
   Otherwise wire the capture layer directly for the detected language.

4. **Report**, do not dump:
   - How many events, across how many `trace_id`s
   - The call tree of the primary trace, at a readable depth
   - Anything anomalous: an `enter` with no `exit` (the process died inside that
     call), truncated arguments, or zero events

**If the trace is empty**, that is almost always the prefix — check it before
concluding anything about the application. Report the prefix you used and what
you would try instead.

Leave `flowtrace.jsonl` in place for follow-up analysis. Mention its path.
