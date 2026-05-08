---
name: sprint
description: Run a wave-based, parallel sprint for a multi-domain or substantial feature. Builds a workflow graph and orchestrates concurrent specialized subagents per wave. Use when the work crosses multiple domains (e.g. backend + frontend) or contains independent streams that benefit from parallelization. Reads `next_task_get` for continuity. For single-domain work use /task-with-jig.
disable-model-invocation: true
argument-hint: "[sprint description]"
---

Plan and execute a sprint for: **$ARGUMENTS**

You are the orchestrator. You do NOT implement code yourself. You scope the work, build a graph, delegate each wave to subagents, verify their output, and close out.

## Step 0 — Continuity hand-off

Call `next_task_get`. If `found: true`, read the `injection` block — it preserves the user's previous task summary across `/clear`. Use it to inform scope decisions: do not redo done work, align with prior choices.

## Step 0.5 — Scope check (do this before planning waves)

State the user-visible deliverable in one sentence. Example: "User can create, edit, and archive playlists from the web UI, persisted to the database."

Then test scope:

- **Too small for a sprint** if the deliverable is "add a field", "fix a bug", "rename a function across the repo", or anything a single subagent could finish in one phase. Stop and tell the user to use `/task-with-jig` (or just describe the task without a slash command if it is trivial).
- **Right-sized for a sprint** if the deliverable is a vertical slice that touches at least two of: domain model, backend handlers, frontend UI, integration tests, infra/migrations.
- **Too big for one sprint** if the deliverable would take more than a few subagents per wave, or if waves cannot enumerate cleanly. Suggest the user break it into 2–3 sprints with explicit hand-off summaries.

If the scope is wrong, stop here. Do not build a graph for under-scoped work — the ceremony will outweigh the value.

## Step 1 — Plan the waves (minimum-waves principle)

Group all the work into the **smallest** number of waves that respect dependencies. Defaults that bias toward fewer, more substantial waves:

- A **2-wave** sprint (Implementation + Validation) is fine and often optimal.
- A **3-wave** sprint typically looks like Foundation → Implementation (parallel backend + frontend agents in the same wave) → Validation.
- A **4+ wave** sprint should be rare. If you reach it, ask whether the deliverable is actually one sprint or two.

Wave shapes (use only the ones the deliverable actually requires — do not pad):

| Wave | Purpose | Skip when |
|------|---------|-----------|
| Foundation | Domain types, migrations, shared schemas | No new shared types/schema needed |
| Implementation | Backend handlers, frontend UI, glue — parallel agents in the same wave when files do not collide | Trivial vertical |
| Tests (cross-cutting) | E2E, contract, integration tests that span multiple agents' work | Each implementation agent already wrote its own unit/integration tests in-wave |
| Validation | Single serial agent runs the project check pipeline (build, lint, type-check, tests) | Never skip — this is the gate |
| Docs | README, changelog, status updates | Internal-only change |

**Tests travel with their implementation by default.** The backend agent in Implementation writes the backend's tests in the same wave. The frontend agent does the same. Only spin up a separate Tests wave when the testing is genuinely cross-cutting (E2E that spans multiple agents' surfaces, contract tests between services).

**Validation is one serial agent**, not a parallel wave. Build + lint + type-check + tests in one place avoids coordination overhead and makes failures easy to read.

## Step 2 — Build the graph (via jig's internal proxy)

The graph builder tools live behind the `graph` internal proxy — not on jig's top-level surface.

1. Discover schemas:
   ```
   proxy_tools_search(query="graph_builder")
   ```

2. Create the graph:
   ```
   execute_mcp_tool("graph", "graph_builder_create", {
     "graph_id": "sprint-<short-slug>",
     "name": "<descriptive name>",
     "description": "<one-line deliverable>"
   })
   ```

3. Add one node per wave with:
   - `id` (e.g. `wave_implementation`)
   - `name`
   - `prompt_injection` — the exact instructions you will paste into each subagent of that wave (file paths, acceptance criteria, constraints)
   - `tools_blocked` if you want to enforce read-only phases
   - Add via `execute_mcp_tool("graph", "graph_builder_add_node", {...})`

4. Add edges between waves with phrase conditions:
   ```
   execute_mcp_tool("graph", "graph_builder_add_edge", {
     "graph_id": "...",
     "from_node": "wave_implementation",
     "to_node": "wave_validation",
     "id": "impl_to_validate",
     "phrase": "implementation complete"
   })
   ```

5. Validate + save:
   ```
   execute_mcp_tool("graph", "graph_builder_validate", {"graph_id": "..."})
   execute_mcp_tool("graph", "graph_builder_save", {"graph_id": "..."})
   ```
   Writes YAML to `<project>/.claude/workflows/<graph_id>.yaml`.

6. Activate:
   ```
   graph_activate(graph_id="<your id>")
   ```

> **Why a proxy:** the graph builder API is large (10+ tools) and most sessions never touch it. Proxying keeps jig's top-level surface tight while staying one search away.

## Step 3 — Present the plan

Before kicking anything off, show the user:

```
Deliverable: <one sentence>

| Wave | Purpose | Agents | Parallel? |
|------|---------|--------|-----------|
```

Ask for approval. The user might want to merge waves, change agents, or change scope. Wait for their go-ahead before building.

## Step 4 — Execute waves

For each wave:

1. `graph_traverse` into the wave's node (the activation puts you on the first node; subsequent waves require an explicit traverse).
2. Read the wave's `prompt_injection`.
3. Launch all agents within the wave **concurrently** with `run_in_background: true`. Each agent receives:
   - The wave's `prompt_injection`.
   - The user's original sprint description verbatim.
   - The Step 0 continuity injection if any.
   - Concrete file paths to read first (use Glob/Grep yourself if you need to surface them — do not make agents guess).
   - Acceptance criteria for *this wave only*.
   - Self-contained context (assume zero shared memory with sibling agents).
   - "Write the tests for your own work in this same wave unless told otherwise."
4. **Never** launch agents in the same wave that write to the same files — they will conflict.
5. After all agents complete, **verify their output** before advancing. Read the files they claim to have changed. Do not trust summaries.
6. If the analysis provider reports new high/critical findings, resolve them before traversing.

## Step 5 — Validate (single agent, serial)

Run the project's check pipeline through one agent (or directly if simple):

- Build: `npm run build`, `cargo check`, `pytest --collect-only`, etc.
- Lint: `ruff check`, `eslint`, `clippy`.
- Type check: `mypy`, `tsc --noEmit`, etc.
- Tests: `pytest`, `npm test`, `cargo test`.

If anything fails, fix the root cause before declaring done. Do not split the validation across parallel agents — failures are easier to read and act on when serial.

## Step 6 — Close out

1. `graph_reset` to clear the workflow.
2. **Save the hand-off:** call `next_task_record(summary=<final summary>, task_description=<original sprint description>, files_changed=[<paths>])`. This is what makes the next `/clear` + new sprint preserve continuity.
3. Final summary for the user (3–5 sentences): deliverables shipped, files changed, validation result.

## Recovery — if jig MCP disconnects mid-sprint

If `graph_status` / `graph_reset` become unreachable, the user can clear persisted graph state from a terminal:

```bash
jig graph reset --project <PROJECT_PATH>
```

After they restart Claude Code, you can resume.

## Hard rules

- Run Step 0.5 scope check first. Refuse to build a sprint for trivial work — recommend `/task-with-jig` or no slash command.
- Bias toward **fewer, more substantial waves**. Two waves is often correct.
- Tests travel with their implementation by default; separate Tests wave only for cross-cutting testing.
- Validation is **one serial agent**, never parallel.
- Main context is the orchestrator — delegate **all** implementation to specialized subagents.
- Launch independent agents within a wave concurrently with `run_in_background: true`.
- Never launch agents that write to the same files in the same wave.
- After all agents in a wave complete, verify their output before advancing.
- Do not commit until the Validation wave passes. Do not commit unless the user explicitly asks.
- If the analysis provider reports new high/critical findings in Validation, fix before declaring done.
- Architecture review criteria come from project CLAUDE.md, not invented ad-hoc.
- Always end with `next_task_record` so `/clear` is safe between sprints.
