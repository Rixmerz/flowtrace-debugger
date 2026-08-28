---
name: flowtrace-analysis
description: Read and reason about a flowtrace.jsonl execution trace — reconstruct the call tree, find where an error came from, compare two runs, or locate where time went. Use whenever a flowtrace.jsonl (or any FlowTrace v2 JSONL trace) is involved, when the user asks what their code actually did at runtime, or when static reading of the source has not explained a bug.
---

# Analyzing a FlowTrace trace

A FlowTrace run produces `flowtrace.jsonl`: one JSON object per line, recording
every instrumented method entry and exit. It is a record of what actually ran,
which makes it useful precisely when reading the source has stopped helping —
unexpected call order, a value that is wrong before it reaches the code you
suspected, a path you did not know was taken.

## Event shape (v2)

Two event types, always paired. `enter` opens a span, `exit` closes it.

```json
{"ts":1786543293.263,"trace_id":"<32 hex>","span_id":"<16 hex>","parent_id":null,
 "event":"enter","thread":"main","lang":"java","module":"com.example.golden",
 "class":"Calculator","method":"run","visibility":"public","args":{},"depth":0}
```

`exit` carries everything above plus `result`, `duration_ns`, and `error` when
the call threw.

Fields that carry the most weight when reading a trace:

- **`parent_id` / `depth`** — the call tree. `parent_id` is null at a root.
  `depth` is redundant with the tree but makes flat reading legible.
- **`trace_id`** — one logical execution. A server handling many requests
  produces many trace_ids in one file; scope to one before drawing conclusions.
- **`visibility`** — `private` methods are captured too. Capturing them is a
  deliberate v2 capability, and they are often where the real logic lives.
- **`duration_ns`** — wall time for the span, inclusive of children. Subtract
  children to get self-time before calling something "slow".
- **`args` / `result`** — may be truncated. A value rendered as
  `<truncated:"xxx...>` hit the `max-arg-length` limit (default 512); re-run
  with a higher limit rather than reasoning about a clipped value.

## Tools

When the FlowTrace plugin is installed its MCP server provides:

| Tool | Use it for |
|------|-----------|
| `log_open` | Load a trace file, returns a `sessionId` every other call needs |
| `log_schema` | Field inventory — check this before assuming a field exists |
| `log_search` | Filter events by field predicates |
| `log_aggregate` | Group and count/sum — the fastest route to "where did time go" |
| `trace_tree` | Rebuild the nested call tree for one `trace_id` |
| `trace_find_error` | Locate a failing span and walk its parents back to the root |
| `trace_private_calls` | Just the private-method calls |
| `trace_diff` | Compare two runs — spans only in one, duration deltas |

It also serves one resource, **`flowtrace://runtimes`** — which runtimes are
supported, their minimum versions, how each is invoked, where the package
prefix comes from, and what cross-process propagation each has. Read it before
telling anyone whether their language is supported or how to install anything.
It is authoritative: any README, command or skill that disagrees with it is
stale, including this file.

Without the MCP server this is plain JSONL — one self-contained JSON object per
line — so `Read`, `Grep` and `jq` are enough. For example, the slowest calls:
`jq -s 'map(select(.event=="exit")) | sort_by(-.duration_ns) | .[:10]' flowtrace.jsonl`

## How to approach a trace

**Start by scoping.** `log_open`, then find how many distinct `trace_id`s the
file holds. Answering a question against a file containing many interleaved
executions is the most common way to reach a confident wrong conclusion.

**For a bug:** `trace_find_error` gives the failing span and its ancestry. Read
the `args` of each ancestor going down — the point where a value first becomes
wrong is usually several frames above where the exception surfaced.

**For "why is this slow":** `log_aggregate` over `duration_ns` grouped by
method. Then subtract child time from parent time before concluding — a method
whose total is large may be doing nothing but waiting on one child.

**For a regression:** capture a trace on the good revision and one on the bad,
then `trace_diff`. Spans present in only one run tell you about changed control
flow; large duration deltas tell you about changed cost.

**For "what actually ran":** `trace_tree` on the relevant `trace_id` and read
it top-down. This is the cheapest way to discover that the code you were
reading was never called.

**For a chain of services:** the ids are W3C Trace Context compatible, so a
request that crosses processes keeps ONE `trace_id` and reads as a single tree
even though each process wrote its own file. Load them together (or concatenate
them) and `trace_tree` the shared id.

If the halves carry *different* `trace_id`s, the hop dropped the header — the
chain is not joined and no per-hop analysis can tell you it is. That is a
finding. Usual causes: the caller never attached `traceparent` (Go and Python
do not attach it outbound on their own), or the child was launched without
`FLOWTRACE_TRACEPARENT`. `flowtrace://runtimes` has the per-runtime matrix.

## Reading discipline

- An absent method means it was **not instrumented**, not that it did not run.
  Check the package prefix before concluding anything from a gap — scoping to
  user code is mandatory in practice, so framework and stdlib frames are
  missing by design.
- `enter` without a matching `exit` means the process died inside that call.
  That is a finding, not corrupt data.
- Durations include child spans. Always.
- Do not infer causation from adjacency. Two spans next to each other in the
  file may be unrelated work on different threads — check `thread` and
  `trace_id`.
