# Characterisation with traces

A characterisation (golden-master) test pins what code *does* today, so a
refactor can be checked against it. With FlowTrace the pinned thing is a trace:
record one before the change, record another after, and compare behaviour.

`flowtrace diff` (CLI) and `trace_behavior_diff` (MCP tool) do the comparison.
They are the same code. The older `trace_diff` only compares which methods ran
and their average durations; it does not see arguments, results or errors.

## Workflow

```bash
# 1. Record a baseline on the known-good revision and commit it.
flowtrace run -- python checkout.py          # writes .flowtrace/<timestamp>.jsonl
mkdir -p characterisation
cp .flowtrace/<timestamp>.jsonl characterisation/checkout.jsonl

# 2. After the change, record again and compare.
flowtrace run -- python checkout.py
flowtrace diff characterisation/checkout.jsonl .flowtrace/<new-timestamp>.jsonl
echo $?        # 0 same, 1 different, 2 usage / I/O error or incomplete comparison
```

Drive the program with a fixed input, and set a package prefix
(`flowtrace init` auto-detects one) so the trace holds your code and not the
frameworks under it.

Options: `--ignore-method <glob>` and `--ignore-key <key>` (both repeatable),
`--ignore-order`, `--no-error-msg`, `--limit N` (samples per category, default
10; counts are always exact), `--json` (the same object the MCP tool returns).

## What is compared

Both traces are folded into call trees. A call's identity is
`lang|module|class|method`; its payload is its normalised `args`, `result` and
error type (and message, unless `--no-error-msg`). Sibling lists are aligned
with an LCS, so one inserted call does not turn every later sibling into a
difference. The verdict is `same` or `different`, with exact counts for:

- `calls_added`, `calls_removed`, `calls_reordered`
- `args_changed`, and `result_changed` (same arguments, different answer)
- `error_changed` (appeared, disappeared, or changed type), `error_msg_changed`
- `count_changed`: per-method call counts

Each sample carries the call path from the root and only the keys that differ.

## What is ignored or normalised by default

- Ignored: `ts`, `duration_ns`, `trace_id`, `span_id`, `parent_id`, `thread`,
  `file`, `line`, `visibility`, `depth`, and error stacks.
- `<redacted>` compares equal to `<redacted>`.
- Identity hashes (`Foo@1a2b3c`) and memory addresses (`0x7f3a9c0e1d40`,
  Python's `<Foo object at 0x...>`) are rewritten to a placeholder. Short hex
  constants such as `0xff` are compared as they are.
- Key order inside args/result is irrelevant.

## Adding ignores

Anything volatile that the capture layers do not already redact (generated ids,
wall-clock values) will show up as a difference. Name it:

```bash
flowtrace diff base.jsonl now.jsonl --ignore-key created_at --ignore-key 'result.order.id' \
  --ignore-method 'app.Logger.*'
```

- A bare key (`created_at`, `*_at`) matches at any depth. A path anchored at
  `args.` or `result.` matches exactly there; `*` stands for one segment.
- `--ignore-method` globs match `module.class.method`; a matching call is
  dropped together with everything it calls.

To make them permanent put a `characterisation.json` **next to the baseline**
(it is committed with it, so CI sees it), or in `.flowtrace/` (local only,
because `flowtrace init` gitignores that directory):

```json
{ "ignoreKeys": ["created_at", "result.order.id"],
  "ignoreMethods": ["app.Logger.*"],
  "ignoreOrder": false, "compareErrorMsg": true }
```

Flags add to the file's lists. Unknown keys in the file are an error (exit 2),
so a typo cannot silently weaken the comparison.

## Truncated values

A value cut by the capture layer is `<truncated:{prefix}...>`. Two such values
compare by their kept prefix only: equal prefixes count as equal, but this is
reported (`truncated_values`, and a warning) because the part beyond the prefix
was never seen. Differences inside the prefix are reported and flagged
`truncated`. Raise `max-arg-length` (0 = no truncation) when the large values
matter.

## Limits

- **Threads and async.** Order across threads or tasks is scheduling, not
  behaviour. When two traces span several threads and show added/removed/
  reordered calls, the output warns you. Use `--ignore-order` for such flows:
  siblings are then compared as an unordered set (and a real change inside a
  permuted list is still reported). Strict order is the default.
- **Cross-process.** Each file is one process's trace. Merge the files of a
  request first if you want to compare across a process hop; otherwise each
  process is compared on its own, and a span whose parent is not in the file is
  treated as a root.
- **Layers differ.** A Node trace and a Python trace of the same program have
  different shapes (nested functions, for instance). Compare like with like.
- **Size.** Work is bounded: past `--max-spans` (default 2,000,000) or the
  alignment budget the output says `truncated` / `complete: false`. An
  incomplete comparison never exits 0, because an unproven "same" must not pass
  a gate. Call counts still cover everything.
- A characterisation trace only pins the paths your driver exercised.
