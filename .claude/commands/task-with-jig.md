---
name: task-with-jig
description: Run a phase-enforced workflow for a medium, single-domain task with one specialized subagent. Use when the task warrants gated phases (refactor with regression risk, bugfix in load-bearing code, feature inside one domain that crosses understand → design → implement → verify). NOT for trivial 1-3 line edits and NOT for multi-wave parallel work. Reads `next_task_get` for continuity. For multi-domain or parallelizable work, use /sprint.
disable-model-invocation: true
argument-hint: "[task description]"
---

Execute this task using jig's phase-gated workflow + a specialized subagent: **$ARGUMENTS**

You are the orchestrator. Do NOT implement code yourself. Pick the right workflow, delegate the work to a subagent, advance phases, then close out.

## When this command is the wrong tool

Stop and recommend a different path before doing anything else if any of these apply:

- The task is **trivial** (≤5 minutes of edits, no structural risk, no test surface). The phase-enforcement ceremony costs more than the fix. Tell the user to just describe the task without `/task-with-jig`.
- The task is **multi-domain** (backend + frontend, multiple parallelizable streams). Recommend `/sprint`.
- The task is **exploratory** ("find out why X happens", no concrete change yet). Recommend running an `Explore` or `debugger` subagent without a workflow.

`/task-with-jig` earns its overhead when phase enforcement provides real value: a refactor where you want a "design before implement" gate, a bugfix where you want "reproduce before fix", a feature where verification cannot be skipped.

## Step 0 — Continuity hand-off (always run first)

Call `next_task_get`. If `found: true`, treat the returned `injection` block as **prior context** — the user just finished a task and ran `/clear` to free their conversation context, but the thread continues. Read the summary, then proceed.

If `found: false`, this is the first task in the series; skip and continue.

> Why: this lets the user run `/clear` between tasks to keep the
> context window tight without losing the high-level continuity of
> what was just done.

## Step 1 — Pre-flight

1. Call `graph_status`. If a workflow is already active, ask the user whether to continue it instead of starting a new one. Stop here if they say yes.
2. Call `graph_list_available` to see workflow IDs.
3. Pick the workflow that fits the task:
   - bug / regression / unexpected behavior → **debug**
   - new feature / endpoint / UI surface → **demo-feature** (or the project's feature workflow if listed)
   - refactor / cleanup with no behavior change → **demo-feature** (use understand → design → implement; skip verify if no test surface)
   - if nothing fits, see Step 1b — you can build one.

### Step 1b — Building a graph on demand (rare but supported)

If no listed graph fits and the task warrants a custom phase flow, the graph builder lives behind jig's internal proxy:

1. `proxy_tools_search(query="graph_builder")` — returns the schemas for `graph_builder_create`, `graph_builder_add_node`, `graph_builder_add_edge`, `graph_builder_save`, `graph_builder_validate`.
2. `execute_mcp_tool("graph", "graph_builder_create", {...})` — builds the graph in memory.
3. Iterate with `execute_mcp_tool("graph", "graph_builder_add_node"|"add_edge", ...)`.
4. `execute_mcp_tool("graph", "graph_builder_save", {...})` — persists it as YAML in `.claude/workflows/`.
5. Then `graph_activate(graph_id=<new id>)` like any other.

If you find yourself doing this, the task probably belongs in `/sprint` — stop and recommend it.

## Step 2 — Pick the specialist subagent

Match the task to ONE subagent. If it spans domains, this command is the wrong tool — recommend `/sprint`.

| Task shape | subagent_type |
|---|---|
| UI / island / component / styling / Tailwind / Fresh route | `frontend` |
| API / route / service / Prisma schema / backend logic | `backend` (or `general-purpose` if no backend agent deployed) |
| Bug investigation, failing test, performance issue | `debugger` |
| Writing tests, raising coverage | `tester` |
| Code review, dead code, production readiness | `reviewer` |
| Codebase exploration / "where does X live" | `Explore` |
| Designing an approach before coding | `Plan` |

## Step 3 — Activate + brief

1. `graph_activate(graph_id="<chosen>")`. Read the returned `prompt_injection` from the active node — that's the phase the agent enters.
2. Launch the subagent with a self-contained prompt that includes:
   - The user's task verbatim.
   - The Step 0 continuity injection if any (paste it as prior context).
   - The current jig phase + its prompt_injection (so the agent respects `tools_blocked` and the phase intent).
   - Concrete file paths the agent should read first (use `Glob`/`Grep` yourself if you need to surface them — don't make the agent guess).
   - "Acceptance criteria" — what 'done' looks like for THIS phase only (not the whole task).
   - "When you finish this phase, return a summary; do NOT call `graph_traverse` yourself." (You drive phase transitions from the orchestrator.)

## Step 4 — Drive the phases

After each subagent returns:
1. Verify their output (read the files they claim to have changed).
2. If `graph_status` shows pending tensions or DCC critical/high smells: resolve before advancing.
3. `graph_traverse` to the next phase.
4. Re-launch a subagent (same one if continuity matters; switch type if the next phase is a different domain — e.g. implement → tester for the verify phase).
5. Repeat until the workflow's terminal node.

## Step 5 — Close out

1. Run the project's check pipeline (e.g. `cd <subproject> && deno task check`, `npm test`, `pytest`, etc.). If it fails, address it before declaring done.
2. `graph_reset` to clear the workflow.
3. **Save the hand-off:** call `next_task_record(summary=<the summary you're about to give the user>, task_description=<the user's original task in one line>, files_changed=[<paths>])`. This is what makes the next `/clear` + `/task-with-jig` cycle preserve continuity.
4. Summarize for the user: what was done, what files changed, what the check pipeline reported. Two or three sentences.

## Recovery — if jig MCP disconnects mid-task

If you cannot reach `graph_status`/`graph_reset` (MCP server died), the user is at risk of being deadlocked by stuck phase enforcement. Tell them to run from their terminal:

```bash
jig graph reset --project <PROJECT_PATH>
```

That clears the persisted graph state directly without needing the MCP. After they restart Claude Code, you can resume.

## Hard rules

- Do NOT skip phases. If the enforcer blocks a tool, that's load-bearing — read the rationale and traverse, don't work around it.
- Do NOT call `graph_acknowledge_tensions` to bypass a gate; resolve the tension.
- Do NOT commit unless the user asked. The check pipeline is for verification, not auto-commit.
- If a phase needs a tool that's outside the surface ~26, use `proxy_tools_search` then `execute_mcp_tool` from inside the subagent — brief them on this.
- If the task turns out bigger than one workflow (multiple domains, parallelizable waves), stop and tell the user to use `/sprint` instead.
- Always end with `next_task_record` so `/clear` is safe.
