---
paths: ["**/*.test.*", "**/*.spec.*", "**/test_*", "**/tests/**", "**/__tests__/**", "**/test/**"]
---

# QA & Testing Rules

> Always apply these rules when writing or reviewing tests.

## DO
- Follow AAA (Arrange, Act, Assert) structure in every test
- Use descriptive test names: `[unit]_[condition]_[expected]`
- One logical behavior per test -- multiple asserts for the same behavior are fine
- Each test creates and cleans its own data (no shared mutable state)
- Mock external dependencies (APIs, databases, file systems in unit tests)
- Use factories/builders for test data instead of hardcoded literal objects
- Use explicit waits instead of `sleep()` in E2E and async tests
- Verify behavior, not implementation details (test what it does, not how)
- Include assertion messages for non-obvious or complex checks
- Test error cases and edge cases, not just the happy path
- Use parameterized/data-driven tests for multiple inputs with the same logic
- Keep test setup minimal and specific to the test being written
- Run tests in isolation -- no dependency on execution order
- Use containers (TestContainers) for integration tests with real infrastructure
- Verify the full API response: status code + body + headers + side effects
- Use Page Object Model or similar encapsulation for E2E UI tests

## DON'T
- Don't test multiple behaviors in a single test
- Don't depend on test execution order
- Don't use hardcoded IDs, timestamps, or production data in tests
- Don't share mutable state between tests (global variables, class-level state)
- Don't use `sleep()` or fixed delays for timing -- use explicit waits or polling
- Don't catch exceptions silently in tests (empty catch blocks hide failures)
- Don't write assertions without meaningful messages on complex checks
- Don't assert only `!= null` or `is not None` -- verify the actual expected value
- Don't mock what you don't own without a wrapper (mock your adapter, not the library)
- Don't skip flaky tests permanently -- fix them within 2 weeks or quarantine and track
- Don't couple tests to implementation details (CSS selectors as test IDs, internal method names)
- Don't write tests that always pass (`assert true`, `expect(1).toBe(1)`)
- Don't put assertions inside Page Objects or test helpers (assertions belong in tests)
- Don't use random/non-deterministic data without seeding the generator
