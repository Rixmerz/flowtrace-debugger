---
name: audit
description: Run a comprehensive code quality audit using DCC analysis, security scanning, and architecture review. Use for health checks or before releases.
disable-model-invocation: true
argument-hint: "[scope: full|security|quality|architecture]"
context: fork
agent: general-purpose
---

Run a comprehensive audit of this project. Scope: $ARGUMENTS (default: full).

## Steps

1. **Index the project** (if not already indexed):
   - Call `cube_index_directory` on the project root

2. **Code quality analysis**:
   - Call `cube_detect_smells` — report by severity (critical, high, medium, low)
   - Call `cube_get_debt` — report debt score and grade
   - Identify god files, orphans, feature envy, hub overload

3. **Security scan** (if scope is "full" or "security"):
   - Call `cube_check_scanners` to detect available scanners
   - If Trivy or Semgrep available, call `cube_scan_project`
   - Call `cube_finding_stats` — report by severity
   - Call `cube_attack_surface` — identify dangerous entry points

4. **Architecture review** (if scope is "full" or "architecture"):
   - Call `cube_analyze_graph` — report centrality metrics
   - Call `cube_detect_clones` — identify code duplication
   - Call `cube_detect_drift` — check for semantic/contract divergence

5. **Generate report**:
   ```
   ## Audit Report — [project name]

   | Category | Score | Grade | Details |
   |----------|-------|-------|---------|
   | Code Quality | X/100 | A-F | N smells (H high, M medium) |
   | Technical Debt | X/100 | A-F | Top debt files |
   | Security | N findings | A-F | N critical, N high |
   | Architecture | — | — | Centrality, clones, drift |

   ### Critical Issues (fix immediately)
   ### Recommendations (prioritized)
   ```
