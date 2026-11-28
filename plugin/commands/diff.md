---
name: diff
description: Compare the behaviour of two FlowTrace traces of the same flow (characterisation check) and report exactly what changed.
argument-hint: "<baseline.jsonl> <current.jsonl> [--ignore-key k] [--ignore-method glob]"
---

Compare the behaviour of two traces: **$ARGUMENTS**

If only a baseline was given, produce the current trace first with
`/flowtrace:trace` on the same command and input, then compare. If neither was
given, look for a committed baseline (a `characterisation/` directory, or a
`*.jsonl` next to a `characterisation.json`) and say which you chose.

Run `flowtrace diff <baseline> <current>` (add `--json` for the full object).
Exit status: 0 same, 1 different, 2 usage / I/O error or incomplete comparison.
In the MCP tools the same check is `trace_behavior_diff` after two `log_open`s —
use that, not `trace_diff`, which sees only timing and which methods ran.

Report:

- The verdict, and whether `complete` is true. An incomplete "same" is unproven.
- Each category with a non-zero count and its samples: the call path and only
  the keys that differ.
- Anything volatile (generated ids, timestamps) that looks like noise: propose
  an `--ignore-key` / `--ignore-method` for it instead of reading past it, and
  never add an ignore just to make the verdict `same`.
- If the traces span several threads and the differences are only added,
  removed or reordered calls, re-run with `--ignore-order` before calling it a
  regression.
