---
name: testing
description: Testing strategy, patterns, and coverage optimization for quality assurance. Use this skill whenever the task involves deciding what to test, how to structure tests, what coverage to aim for, when to use mocks vs real dependencies, or how to write tests that actually catch bugs (not just pass). Also use when the user asks about test pyramids, flaky tests, integration vs unit, TDD, or improving an existing test suite.
---

# Testing Strategy

## The goal of tests

Tests exist to catch regressions and document intent — not to satisfy a coverage number. A test suite that passes but doesn't fail when bugs are introduced is worse than no tests, because it creates false confidence.

## Test pyramid

```
        [E2E]          ← few, slow, high confidence
      [Integration]    ← moderate, test real wiring
    [Unit]             ← many, fast, test logic in isolation
```

**Unit tests** — pure logic, no I/O. Fast enough to run on every save. Test edge cases, error paths, and invariants. Don't test implementation details; test behavior.

**Integration tests** — test that components wire together correctly. Hit real databases, real file systems, real queues where possible. Mock only external services you don't control (third-party APIs, payment providers).

**E2E tests** — test critical user paths end-to-end. Keep them few and focused. They're expensive to write and maintain — use them for the scenarios where a regression would be catastrophic.

## Coverage targets

- **80% line coverage** is a reasonable floor, not a ceiling
- Focus coverage on business logic, not boilerplate
- 100% coverage with bad tests is worse than 70% with good ones
- Measure branch coverage, not just line coverage — uncovered branches are where bugs hide

## When to use mocks

**Mock** when:
- The dependency is an external service you don't control
- The dependency is slow (network, disk) and slowing down the unit test suite meaningfully
- You need to test error paths that are hard to trigger with real dependencies

**Don't mock** when:
- You're testing integration (that's the point — use real dependencies)
- The mock would be more complex than the real thing
- Past experience shows mock/real divergence caused bugs to slip through

## TDD rhythm

1. Write a failing test that describes the desired behavior
2. Write the minimum code to make it pass
3. Refactor — the test suite keeps you safe

TDD works best for well-defined units. For exploratory work, write tests after you understand the shape of the solution.

## Flaky tests

Flaky tests are worse than no tests — they erode trust in the suite. Common causes:
- Time-dependent assertions (use fixed clocks or tolerances)
- Shared mutable state between tests (isolate each test's state)
- Race conditions in async code (use proper await/join, not sleeps)
- Order-dependent tests (each test must be fully independent)

If a test is flaky, fix it or delete it. Never mark it as skipped and move on.

## What to test first when adding coverage

1. Code paths that handle money, auth, or data integrity
2. Edge cases in parsing/validation logic
3. Error paths (what happens when the DB is down, the file is missing, the input is malformed)
4. Anything that has broken in production before

## Test naming

A good test name reads like a specification:
```
test_transfer_fails_when_balance_is_insufficient
test_login_redirects_to_dashboard_on_success
should_parse_iso_date_strings_with_timezone_offset
```

Avoid: `test_login`, `test_1`, `testFoo`. The name should tell you what broke without reading the test body.
