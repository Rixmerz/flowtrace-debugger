# Quality Feedback — Code Analysis & Experience Memory

> Always act on quality signals from the configured code-analysis provider and from experience memory. Never ignore them.

Rules for using the code-analysis provider, experience memory, and workflow quality signals.

jig is provider-agnostic: the active backend (e.g. delta-cube) implements `CodeAnalysisProvider` and is discovered at runtime. When this rule mentions "the provider", treat it as whatever is wired through `get_provider()`.

## DO

- After receiving quality feedback via stderr (PostToolUse hook), prioritize fixing **critical** and **high** severity findings before continuing with new code.
- Use `graph_mid_phase_dcc(files=[...])` proactively after significant edits to surface findings without advancing the workflow phase.
- Read `experience_context` in `graph_traverse` responses — it contains relevant past issues and lessons for the files you are touching.
- When `skill_recommendations` appear in traverse responses, read the suggested skill sections before continuing.
- Use `graph_status` to check `dcc_status.last_analysis` (or its provider-equivalent field) for the most recent quality snapshot.
- Trust the tension gate — if the workflow blocks a transition because of structural tensions, real issues exist. Resolve them, do not bypass.
- When the provider reports `god_file`, `circular_dependency`, or `hub_overload` smells, refactor before adding more code to those files.

## DON'T

- Don't ignore delta feedback (the "+N new smells" stderr messages) — every increment matters.
- Don't acknowledge tensions just to bypass the gate. Resolve them or document why they are intentional.
- Don't skip the baseline quality analysis on workflow activation — it gives starting context.
- Don't add code to files already flagged as `god_file` without splitting them first.
- Don't treat warnings as optional — they reflect real structural degradation that compounds.
- Don't hard-code provider-specific tool names in your own scripts — go through `get_provider()` so the rule survives a backend swap.

## When no provider is installed

The orchestrator-level `NullProvider` returns empty results for all queries. In that mode:

- Workflows still run, but tension gates and smell deltas will not surface real signal.
- Recommend the user install a provider (e.g. `pip install jig-delta-cube`) if they want quality enforcement.
- Do not fabricate findings to fill the gap.
