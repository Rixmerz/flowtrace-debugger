---
name: validation
description: Production readiness validation — runs all checks before merging or deploying. Use this skill whenever the task involves verifying that code is ready to ship: type checking, linting, tests passing, coverage thresholds, dead code, security issues, or any pre-merge checklist. Also use when the user asks "is this ready?", wants a pre-PR review, or needs to confirm nothing is broken after a refactor.
---

# Production Readiness Validation

## What "ready to ship" means

Code is ready when it passes every check below. Skipping checks to move faster is borrowing from the future — the debt always comes due.

## Validation checklist

Run these in order. Stop and fix before continuing if any fail.

### 1. Type checking
```bash
# TypeScript
pnpm tsc --noEmit

# Python
mypy src/

# Rust
cargo check
```
Zero errors required. Warnings are acceptable but worth reviewing.

### 2. Linting
```bash
# TypeScript/JS
pnpm lint   # or: eslint src/

# Python
ruff check src/   # or: flake8

# Rust
cargo clippy -- -D warnings
```
Linting catches style issues and common bugs the type checker misses. Treat lint errors as blocking.

### 3. Tests
```bash
# Run the full test suite
pnpm test          # JS/TS
pytest             # Python
cargo test         # Rust
```
All tests must pass. If a test is flaky and you're tempted to skip it — fix it instead.

### 4. Coverage threshold
Coverage must meet the project's floor (typically 80% line + branch).
```bash
pnpm test --coverage
pytest --cov=src --cov-fail-under=80
cargo tarpaulin --fail-under 80
```
If you added new code without tests, coverage will drop. Write the tests.

### 5. Dead code
Remove unused exports, functions, variables, and imports. Dead code is a maintenance burden and can hide bugs.
```bash
# TypeScript
pnpm tsc --noEmit   # catches some; also review ESLint no-unused-vars

# Python
ruff check --select F401,F811   # unused imports
vulture src/                     # unreachable code
```

### 6. Security
- No secrets, API keys, or passwords hardcoded in source
- No `TODO: fix security` comments left open
- Dependencies up to date (no critical CVEs)
```bash
npm audit --audit-level=high
pip-audit
cargo audit
```

### 7. Build
The final check — the code must actually compile and build.
```bash
pnpm build
cargo build --release
```
If it type-checks and tests pass but the build fails, something is wrong with your build configuration.

## When to run this

- Before every PR/MR — no exceptions
- After a large refactor
- Before cutting a release branch
- After merging upstream changes that touch your area

## What counts as a blocker

| Check | Blocker? |
|-------|----------|
| Type errors | Yes |
| Lint errors | Yes |
| Failing tests | Yes |
| Coverage below threshold | Yes |
| Security: critical/high CVE | Yes |
| Dead code | No (but fix it) |
| Security: medium/low CVE | No (track it) |
| Build warnings | No (but review) |

## If something fails

1. Fix the root cause — don't suppress the error
2. Re-run the full checklist from the top (fixes can introduce new issues)
3. Commit only after the full checklist passes

Never use `--no-verify`, `// @ts-ignore`, `# type: ignore`, or `#[allow(dead_code)]` to bypass checks without a documented reason. If you must suppress, add a comment explaining why and link to the tracking issue.
