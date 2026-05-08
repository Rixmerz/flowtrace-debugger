# Testing Design Patterns

## AAA (Arrange, Act, Assert) -- Universal Test Structure

The fundamental pattern for structuring any test:

```
// Arrange: Set up preconditions and inputs
user = createUser(name: "Alice", role: "admin")
service = new UserService(mockRepo)

// Act: Execute the behavior under test
result = service.promote(user)

// Assert: Verify the expected outcome
assert result.role == "superadmin"
assert mockRepo.saveCalledWith(user)
```

Rules:
- One Act section per test (single behavior)
- Arrange can be shared via setup/fixtures if common across tests
- Assert verifies both return value and side effects when relevant

## GWT (Given, When, Then) -- BDD with Gherkin

```gherkin
Feature: User promotion

  Scenario: Admin promotes user to superadmin
    Given a user "Alice" with role "admin"
    When the admin promotes the user
    Then the user's role should be "superadmin"
    And an audit log entry should be created

  Scenario Outline: Role-based access
    Given a user with role "<role>"
    When they attempt to access "<resource>"
    Then the response should be "<result>"

    Examples:
      | role    | resource    | result  |
      | admin   | /dashboard  | allowed |
      | viewer  | /dashboard  | allowed |
      | viewer  | /settings   | denied  |
```

GWT maps directly to AAA: Given = Arrange, When = Act, Then = Assert.

## Page Object Model (POM) -- E2E Encapsulation

Encapsulate page structure and interactions behind a clean API:

```
class LoginPage:
    // Locators (private)
    usernameInput = locator("#username")
    passwordInput = locator("#password")
    submitButton  = locator("button[type=submit]")
    errorMessage  = locator(".error-msg")

    // Actions (public API)
    function login(username, password):
        fill(usernameInput, username)
        fill(passwordInput, password)
        click(submitButton)
        return new DashboardPage()

    function getError():
        return text(errorMessage)

// Test uses page objects, never raw selectors
test "invalid login shows error":
    loginPage = new LoginPage()
    loginPage.login("bad@user.com", "wrong")
    assert loginPage.getError() == "Invalid credentials"
```

Principles:
- Page objects expose business actions, not DOM details
- Never put assertions inside page objects
- Methods return other page objects for navigation flows
- Single source of truth for selectors

## Screenplay Pattern -- Actor-Based Evolution of POM

```
actor = Actor("Alice")
actor.attemptsTo(
    Navigate.to("/login"),
    Enter.theValue("alice@test.com").into(LoginForm.EMAIL),
    Enter.theValue("password123").into(LoginForm.PASSWORD),
    Click.on(LoginForm.SUBMIT)
)
actor.should(
    See.that(Dashboard.WELCOME_MESSAGE, equals("Welcome, Alice"))
)
```

Better than POM for complex multi-actor scenarios (e.g., "Alice sends message, Bob receives it").

## Test Data Management

| Strategy | When to Use | Trade-off |
|----------|-------------|-----------|
| **Fixtures** (static JSON/YAML) | Small, stable datasets | Easy to read, hard to maintain at scale |
| **Factories** (Factory Boy, Bogus) | Dynamic object creation | Flexible, DRY, handles relationships |
| **Seeders** (DB seed scripts) | Integration tests needing real DB state | Realistic, slow setup |
| **Fakers** (@faker-js/faker) | Realistic random data | Good for edge cases, non-deterministic |
| **DB reset** (transaction rollback) | Each test gets clean DB | Fast, isolated, requires transaction support |
| **Snapshots** (DB dumps) | Complex initial state | Fast restore, versioning needed |

Best practice: **Factories + DB reset per test** for integration tests.

## Test Doubles -- Definitions and When to Use

| Double | Definition | When to Use |
|--------|------------|-------------|
| **Dummy** | Object passed but never used | Fill required parameters |
| **Stub** | Returns predefined responses | Control indirect inputs |
| **Spy** | Records calls for later assertion | Verify interactions happened |
| **Mock** | Pre-programmed with expectations | Verify specific call patterns |
| **Fake** | Working implementation (simplified) | In-memory DB, local file system |

```
// Stub: controls what the dependency returns
stubPaymentGateway.whenCharged(100).thenReturn(Success)

// Spy: records interactions for assertion
spyEmailService.send(user, "Welcome!")
assert spyEmailService.sendCalledTimes == 1

// Fake: simplified but functional implementation
fakeUserRepo = InMemoryUserRepository()
fakeUserRepo.save(user)
assert fakeUserRepo.findById(user.id) == user
```

## Test Doubles for External Services

Use HTTP-level mocking for external APIs:
- **WireMock** (Java): Programmable HTTP mock server
- **MockServer**: Multi-language HTTP mock
- **MSW** (Mock Service Worker, JS): Intercepts at network level
- **VCR/Cassettes** (Ruby, Python): Record and replay HTTP interactions

Rule: Mock at the boundary, not internal logic.

## TDD Cycle (Red -> Green -> Refactor)

```
1. RED:    Write a failing test for the next behavior
2. GREEN:  Write the minimum code to make it pass
3. REFACTOR: Clean up code and tests, keep tests green
```

Uncle Bob's Three Rules of TDD:
1. You may not write production code except to make a failing test pass
2. You may not write more of a test than is sufficient to fail
3. You may not write more production code than is sufficient to pass the test

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| **God Test** | Tests everything in one test | Split into focused tests |
| **Crystal Test** | Breaks on any implementation change | Test behavior, not implementation |
| **Fridge Test** | Test that always passes (`assert true`) | Add meaningful assertions |
| **Slow Poke** | Integration test used where unit suffices | Push down the test pyramid |
| **Shared Setup** | Tests depend on shared mutable state | Each test owns its data |
| **Magic Numbers** | Hardcoded values without explanation | Use named constants or factories |
| **The Inspector** | Tests private methods directly | Test through public API |
| **Chain Gang** | Tests must run in specific order | Make each test independent |
| **The Mockery** | Everything is mocked, nothing is real | Mock boundaries, not internals |
| **Copy-Paste Test** | Duplicated test code everywhere | Extract helpers, use parametrize |
| **The Silent Catcher** | Empty catch blocks hide failures | Let exceptions propagate |
| **Eager Test** | Asserts too many things at once | One logical behavior per test |
