# Testing Best Practices

## Test Naming Convention

Pattern: `[unit]_[condition]_[expected result]`

```
// Good
calculateDiscount_withPremiumUser_returns20Percent
parseEmail_withMissingAtSign_throwsValidationError
loginEndpoint_withExpiredToken_returns401

// Bad
test1
testCalculate
it_works
shouldWork
```

For BDD-style frameworks:
```
describe("calculateDiscount")
  context("with premium user")
    it("returns 20% discount")
```

## Core Principles

### One logical assertion per test
Test one behavior. Multiple `assert` calls are fine if they verify the same logical outcome.

```
// Good: multiple asserts, one behavior
test "createUser returns complete user object":
    user = createUser("Alice", "alice@test.com")
    assert user.name == "Alice"
    assert user.email == "alice@test.com"
    assert user.id != null
    assert user.createdAt is recent

// Bad: multiple behaviors in one test
test "user operations":
    user = createUser("Alice", "alice@test.com")
    assert user.name == "Alice"
    updatedUser = updateUser(user, name: "Bob")
    assert updatedUser.name == "Bob"
    deleteUser(user.id)
    assert findUser(user.id) == null
```

### Each test owns its data
Create data in setup, clean in teardown. Never rely on data from another test.

```
// Good
beforeEach:
    user = factory.create(User, name: "Alice")

test "update user name":
    updatedUser = updateUser(user, name: "Bob")
    assert updatedUser.name == "Bob"

// Bad: depends on data from previous test or global seed
test "update the user we created in test_create":
    user = findUser(globalUserId)  // fragile, order-dependent
```

### Mock external dependencies, not internal logic
```
// Good: mock the HTTP client (external boundary)
mockHttpClient.whenGet("/api/weather").thenReturn({ temp: 72 })
result = weatherService.getForecast("NYC")
assert result.temperature == 72

// Bad: mock internal helper
mockTemperatureConverter.convert(72).thenReturn(22.2)  // testing implementation
```

### Descriptive assertion messages
```
// Good
assert result.statusCode == 200,
    "Expected 200 OK but got {result.statusCode}: {result.body}"

// Bad
assert result.statusCode == 200
```

### Test behavior, not implementation
```
// Good: tests the observable behavior
sorted = sort([3, 1, 2])
assert sorted == [1, 2, 3]

// Bad: tests implementation detail (algorithm used)
assert sort.algorithm == "quicksort"
assert sort.comparisons == 3
```

### API test completeness
Verify the full response, not just status code:
```
response = POST("/users", { name: "Alice", email: "a@b.com" })

// Check status
assert response.status == 201

// Check body
assert response.body.name == "Alice"
assert response.body.id is present

// Check headers
assert response.headers["Content-Type"] == "application/json"
assert response.headers["Location"] matches "/users/\\d+"

// Check side effects
assert database.findUser(response.body.id) is present
assert emailQueue.lastMessage.to == "a@b.com"
```

## Flaky Test Analysis

### Common Causes

| Cause | Symptom | Fix |
|-------|---------|-----|
| **Timing/race conditions** | Passes locally, fails in CI | Explicit waits, retry with backoff |
| **Shared mutable state** | Fails when run with other tests | Isolate test data, transaction rollback |
| **Network dependency** | Intermittent timeout | Mock external calls, use WireMock |
| **Hardcoded dates/times** | Fails on specific dates | Inject clock, use relative times |
| **Order dependency** | Fails when shuffled | Make each test independent |
| **Resource exhaustion** | Fails under load | Clean up connections, use pools |
| **Timezone sensitivity** | Fails in different CI regions | Use UTC explicitly |
| **Float comparison** | Fails intermittently | Use epsilon/approximate matchers |

### Strategies
1. **Quarantine**: Move flaky tests to a separate suite, don't block CI
2. **Retry with limits**: Allow 1-2 retries, alert if retry rate > 2%
3. **Track flaky rate**: Dashboard with flaky test history
4. **Fix or delete**: Flaky tests older than 2 weeks must be fixed or removed
5. **Deterministic by design**: Seed random generators, freeze time, mock network

## Coverage Types

| Type | What It Measures | Tool Support |
|------|-----------------|-------------|
| **Line** | Lines executed | All coverage tools |
| **Branch** | Decision paths taken (if/else) | Most tools (Istanbul, coverage.py) |
| **Statement** | Statements executed | Most tools |
| **Function** | Functions called | Most tools |
| **Mutation** | Tests that detect code changes | Stryker, PIT, mutmut |
| **Path** | Unique execution paths | Limited tooling |

### Coverage guidance
- **80% line coverage** is a good default target
- **Branch coverage** catches untested conditions that line coverage misses
- **100% coverage != bug-free** -- coverage measures execution, not correctness
- **Mutation testing** reveals tests that execute code but don't verify behavior

## Mutation Testing

Mutation testing modifies (mutates) source code and checks if tests catch the change.

```
Original:     if (age >= 18) return "adult"
Mutant 1:     if (age >  18) return "adult"    // boundary mutation
Mutant 2:     if (age >= 18) return "child"     // return value mutation
Mutant 3:     if (age <= 18) return "adult"     // operator mutation
```

- **Killed mutant**: A test failed (good -- test detected the change)
- **Survived mutant**: All tests passed (bad -- tests are weak)
- **Mutation score**: killed / total mutants (target: >= 60%)

## Process Metrics

| Metric | Formula | Target | Meaning |
|--------|---------|--------|---------|
| **Defect Escape Rate** | Prod bugs / total bugs found | < 10% | How many bugs reach production |
| **Test Pass Rate** | Passed / total tests | > 98% | CI health indicator |
| **MTTD** (Mean Time to Detect) | Avg time from bug introduction to detection | < 1 day | How fast you find bugs |
| **MTTR** (Mean Time to Resolve) | Avg time from detection to fix | < 1 day | How fast you fix bugs |
| **Flaky Test Rate** | Flaky runs / total runs | < 2% | CI reliability |
| **Automation Coverage** | Automated / (automated + manual) tests | > 80% | Automation maturity |
| **Lead Time for Tests** | Time from feature request to test coverage | < sprint | Testing agility |
| **Test Execution Time** | Total CI pipeline duration | < 15 min | Developer feedback speed |
