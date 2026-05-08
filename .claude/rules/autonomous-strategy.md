# Autonomous Strategy — Decision Tree

> Always evaluate this decision tree before responding to any task.

Before responding, evaluate which approach fits:

## 1. Direct Response
Use when: knowledge question, explanation, isolated debug, obvious 1-3 line change.
Just respond — no structure needed.

## 2. Plan Mode
Use when: multi-file feature, architectural decisions needing approval, refactor with regression risk, one-off tasks.
Say "entering plan mode" and use EnterPlanMode.

## 3. Workflow
Use when: well-defined phases (understand → reproduce → fix → verify), recurrent process (debugging, code review, feature dev), phase enforcement matters.

**Why workflows over plan mode:**
- Context persistence across very long tasks — resume mid-flow without losing state
- Dynamic DCC injection — real-time code change tracking, diffs, and quality metrics
- Memory injections — past mistakes and project conventions injected at the right moment
- Phase enforcement — cannot skip steps, each node injects phase-specific context

**Reuse or create?**
- First run `graph_list_available` to check existing workflows
- Reuse if one covers the case (e.g. `debug` for bugs, `feature-dev` for features)
- Create new only if the process is unique — use `graph_builder_create`

## 4. Always

- **LSP First**: check LSP diagnostics before and after code changes when LSP is available
- **Pipeline continuity**: once a workflow starts, complete it without interruption unless blocked by an error or explicit user request
- This decision is yours — do not ask the user which to prefer unless genuinely ambiguous
