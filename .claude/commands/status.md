---
name: status
description: Show project health dashboard with DCC metrics, security findings, test results, and quality trends. Quick health check.
disable-model-invocation: true
context: fork
agent: Explore
---

Generate a project health status report using available data.

## Gather Data

1. **DCC Quality** (if DCC available):
   - Call `cube_get_stats` — files indexed, lines of code
   - Call `cube_detect_smells` with `summary_only: true`
   - Call `cube_get_debt` (if response not too large, use top 5 files only)

2. **Security** (if scan data available):
   - Call `cube_finding_stats`

3. **Trends** (if trend data available):
   - Call `trend_get_summary`

4. **Workflow** (if workflow active):
   - Call `graph_status`

5. **Tests**:
   - Check for test runner: `package.json` scripts, `go.mod`, `Cargo.toml`, `pyproject.toml`
   - Report test command but do NOT run tests (too slow for a status check)

## Present Report

```
┌─────────────────────────────────────────┐
│         Project Health Dashboard        │
├──────────────┬──────────────────────────┤
│ Files        │ N indexed, N lines       │
│ Smells       │ N total (H high, M med)  │
│ Debt Grade   │ A-F (score/100)          │
│ Security     │ N findings (grade)       │
│ Trend        │ Smells: X→Y, Debt: X→Y  │
│ Workflow     │ Node: X, Phase: Y        │
│ Tests        │ Command: `npm test`      │
└──────────────┴──────────────────────────┘
```

Keep the report concise — one screen, no scrolling.
