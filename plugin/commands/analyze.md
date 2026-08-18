---
name: analyze
description: Analyze an existing flowtrace.jsonl and answer a question about what the code actually did at runtime.
argument-hint: "[question, e.g. why does createOrder throw]"
---

Analyze the FlowTrace trace in this project and answer: **$ARGUMENTS**

If no question was given, report the call tree and anything anomalous.

Delegate to the `flowtrace-analyst` subagent — it is read-only and returns
findings rather than file contents, which keeps a large trace out of the main
conversation.

Locate the trace first (`flowtrace.jsonl` in the project root, or under
`.flowtrace/`). If there is none, say so and point at `/flowtrace:trace` to
produce one — do not analyze a stale trace from an earlier revision without
saying that is what you are doing.

Report the subagent's findings, then state the single next action they imply.
