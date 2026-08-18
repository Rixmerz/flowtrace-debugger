---
name: status
description: Show FlowTrace repo health — golden fixtures, per-subproject test state, CI wiring, and workspace consistency. Quick health check.
disable-model-invocation: true
context: fork
agent: Explore
---

Report the health of this repository. Read and inspect; do not fix anything.

## Gather

1. **Golden fixtures** — the load-bearing contract:
   - `node scripts/validate-golden.mjs` — every fixture must exist and validate.
     A fixture reporting zero events is a failure, not a pass.
   - Confirm each `examples/golden/**/expected.jsonl` is tracked by git
     (`git ls-files --error-unmatch`). They were silently gitignored once.

2. **Test state per subproject** — report which ran and which did not:
   - Java: `capture/java/flowtrace-otel-extension` (JUnit; check the integration
     test is not skipping itself)
   - Python: `capture/python` (pytest)
   - Node: `capture/node` (node:test)
   - Consumers: `mcp-server`, `flowtrace-dashboard`, `flowtrace-cli`

3. **CI wiring** — `.github/workflows/v2-ci.yml`:
   - Which branches actually trigger it, and does that include the default branch?
   - Does every subproject with tests have a job?

4. **Workspace consistency**:
   - Exactly one lockfile at the root; no stray `package-lock.json` in a
     workspace package.
   - `packageManager` in the root `package.json` matches the lockfile version.

5. **Git hygiene**:
   - No generated files tracked (`git ls-files | grep -E '\.pyc$|egg-info|node_modules/'`).

## Report

```
## FlowTrace status

| Area | State | Detail |
|------|-------|--------|
| Golden fixtures | N events / M fixtures | pass/fail |
| Java / Python / Node capture | | skipped tests called out explicitly |
| Consumers (mcp, dashboard, cli) | | |
| CI | triggers on … | jobs missing coverage |
| Workspace | | lockfile / packageManager |

### Needs attention
```

Call out silent passes specifically — a suite that skipped everything, a
validator that checked zero items, a job that never ran. Those read as green
and are the failure mode this repo has actually been bitten by.
