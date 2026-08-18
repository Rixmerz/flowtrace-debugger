# Autonomous Strategy — Decision Tree

> Always evaluate this decision tree before responding to any task.

Before responding, evaluate which approach fits:

## 1. Direct Response
Use when: knowledge question, explanation, isolated debug, obvious 1-3 line change.
Just respond — no structure needed.

## 2. Plan Mode
Use when: multi-file feature, architectural decisions needing approval, refactor with regression risk, one-off tasks.
Say "entering plan mode" and use EnterPlanMode.

## 3. Phased execution
Use when: well-defined phases (understand → reproduce → fix → verify), or a recurrent process (debugging, code review, feature dev) where skipping a step is the usual way things go wrong.

Track the phases explicitly with the task tools so progress survives a long
session, and do not start the next phase until the current one is actually
verified — "tests pass" means you ran them.

## 4. Always

- **LSP First**: check LSP diagnostics before and after code changes when LSP is available
- **Continuity**: once a multi-phase task starts, complete it without interruption unless blocked by an error or explicit user request
- **Verify before claiming**: `make test` is the source of truth for this repo
- This decision is yours — do not ask the user which to prefer unless genuinely ambiguous
