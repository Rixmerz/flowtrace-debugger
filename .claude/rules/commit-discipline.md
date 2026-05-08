# Commit Discipline

> Always follow these commit rules — every commit, no exceptions.

Rules for when and how to commit during development work.

## WHEN to commit
- After completing a bug fix (cause identified + fix verified)
- After completing a discrete feature or sub-feature
- After a refactor that improves structure without changing behavior
- After each workflow phase completion (natural checkpoint)
- Before switching context to a different task
- After resolving a set of DCC smells or tensions

## WHEN NOT to commit
- Mid-implementation (incomplete changes that break the build)
- Experimental changes you might revert
- After only reading/exploring files (no actual changes)

## Commit message format
Use conventional commits with a `Why:` body:
```
type: concise description of what changed

Why: root cause, decision rationale, or motivation
```
Types: `fix:`, `feat:`, `refactor:`, `perf:`, `chore:`, `docs:`

## DO
- Focus the `Why:` on the root cause or decision rationale — this is where experiential memory is captured (a PostToolUse hook reads commit messages and saves them for future projects)
- One logical change per commit — don't bundle unrelated fixes
- Write commit messages in English for cross-project memory compatibility
- Example: `fix: login redirect loop\n\nWhy: stale refresh token wasn't cleared on 401, causing infinite redirect between /login and /dashboard`

## DON'T
- Don't write empty-why messages like `fix: update login.ts` — no learning is captured
- Don't bundle multiple unrelated changes into one commit
- Don't commit just to "save progress" on broken code — use git stash instead
