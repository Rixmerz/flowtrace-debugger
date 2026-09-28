// Analysis playbooks served over MCP by `read_skill`, organised for
// progressive disclosure: SKILL.md is short and names the sub-skill to read
// next, so an agent loads only the one that matches its question.
//
// Embedded as strings rather than read from disk because the plugin ships
// this server as a single-file bundle with no files beside it. The plugin's
// own skill (plugin/skills/flowtrace-analysis) is for Claude Code; these are
// for any MCP client, which never sees that directory.

export const SKILLS: Record<string, string> = {
  "SKILL.md": `# FlowTrace trace analysis

Every question starts the same way:

1. \`log_open\` the trace, keep the \`sessionId\`.
2. \`trace_search\` — one line per trace_id. A file often holds many
   executions; pick one before reasoning about anything.
3. Then read the sub-skill that matches the question:

| Question | Read |
|---|---|
| Something threw / returned the wrong thing | \`errors.md\` |
| Something is slow | \`latency.md\` |
| It worked before and not now | \`compare.md\` |

Spend context cheapest-first: \`trace_topology\` (shape, no payloads) before
\`trace_span_details\` (full args/result for spans you chose). \`trace_tree\`
returns both at once and is only worth it for a small trace.

Every list tool reports \`total\` and \`truncated\`. When \`truncated\` is true
you are looking at a fragment — narrow the query instead of concluding.`,

  "errors.md": `# Errors

1. \`trace_errors\` with the trace_id. Compare \`total_error_count\` with
   \`returned\`: several errors are often one root cause re-thrown up the stack.
2. Take the earliest error (the list is in time order). Its \`path\` runs from
   the root to the failing span.
3. \`trace_span_details\` on the span ids along that path, top down. The
   first span whose \`args\` are already wrong is where to look — usually
   several frames above where the exception surfaced.
4. A value shown as \`<truncated:...>\` or \`<redacted>\` is not evidence.
   Re-capture with a larger max-arg-length rather than guessing at it.`,

  "latency.md": `# Latency

1. \`trace_search\` with \`min_duration_ns\` to find the slow executions.
2. \`trace_critical_path\` on one of them. \`by_span\` ranks the spans whose
   own time made up the end-to-end duration; the top entries are the answer
   to "where did the time go" for that execution.
3. Do not sum \`duration_ns\` across spans: it is inclusive, so a nested call
   is counted once per ancestor. Use \`self_ns\` (\`trace_topology\`) or the
   critical path.
4. A span with high \`self_ns\` and no children is doing the work itself; a
   span whose time is all in one child is just waiting on it — follow the
   child.
5. Work started without being awaited can outlive its parent. Such a child is
   not on the critical path even when it is long.`,

  "compare.md": `# Comparing two runs

1. \`log_open\` both traces.
2. \`trace_diff\` — methods present in only one run, and average-duration
   deltas grouped by module+class+method, largest absolute delta first.
3. A method only in the failing run is a branch the good run did not take:
   \`trace_errors\` / \`trace_span_details\` on it in that run.
4. For a regression, \`trace_critical_path\` on one trace from each run and
   compare the \`by_span\` rankings.`,
};

export function readSkill(name: string): string {
  const text = SKILLS[name];
  if (text === undefined) {
    throw new Error(`Unknown skill ${name}. Available: ${Object.keys(SKILLS).join(", ")}`);
  }
  return text;
}
