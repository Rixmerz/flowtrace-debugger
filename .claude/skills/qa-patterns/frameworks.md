# Testing Frameworks & Tools Reference

## Unit / Integration Frameworks

| Language | Framework | Key Trait | Notes |
|----------|-----------|-----------|-------|
| **Java/Kotlin** | JUnit 5 | Annotations, extensions, parameterized | Industry standard |
| **Python** | pytest | Fixtures, parametrize, plugins | Default choice |
| **JS/TS** | Vitest | Vite-native, ESM, fast HMR | Default for Vite projects |
| **JS/TS** | Jest | Mature, snapshots, wide ecosystem | Legacy/React projects |
| **Go** | `testing` | Built-in, table-driven, benchmarks | No framework needed |
| **Swift** | Swift Testing | `@Test`, `#expect`, traits | Modern replacement for XCTest |
| **Ruby** | RSpec | BDD-style, matchers, mocks | Ruby standard |
| **.NET** | xUnit / NUnit | Attributes, theory tests | xUnit for new, NUnit for legacy |
| **Rust** | `cargo test` | Built-in, `#[cfg(test)]` | + cargo-nextest for parallel |

## Mocking & Test Doubles

| Language | Library | Approach |
|----------|---------|----------|
| **Java** | Mockito | Proxy-based, annotations |
| **Python** | `unittest.mock` | Patch, MagicMock (stdlib) |
| **JS/TS** | Jest/Vitest mocks | `vi.fn()`, `vi.mock()` |
| **JS/TS** | Sinon.JS | Standalone spies, stubs, fakes |
| **.NET** | Moq | Lambda-based setup |
| **Go** | testify/mock | Interface-based |
| **Rust** | mockall | Trait-based automocking |

## Assertion Libraries

| Language | Library | Style |
|----------|---------|-------|
| **Java** | AssertJ | Fluent: `assertThat(x).isEqualTo(y)` |
| **Python** | pytest assert | Native: `assert x == y` (with rewrite) |
| **JS/TS** | Chai | BDD: `expect(x).to.equal(y)` |
| **.NET** | FluentAssertions | Fluent: `x.Should().Be(y)` |
| **Go** | testify/assert | `assert.Equal(t, expected, actual)` |

## Fixtures & Test Data

| Tool | Language | Use Case |
|------|----------|----------|
| **Factory Boy** | Python | Model factories with traits/sequences |
| **@faker-js/faker** | JS/TS | Realistic fake data generation |
| **Bogus** | .NET | Fake data + AutoBogus for auto-generation |
| **Instancio** | Java | Random object generation |
| **TestContainers** | Multi | Real DBs/services in Docker for tests |

## API Testing

| Tool | Type | Best For |
|------|------|----------|
| **REST Assured** | Java library | JVM API tests, fluent syntax |
| **Supertest** | JS/TS library | Express/Node API tests |
| **httpx + pytest** | Python library | Async Python API tests |
| **Postman / Newman** | CLI + GUI | Manual + CI API testing |
| **Hoppscotch** | Open-source GUI | Lightweight Postman alternative |
| **Schemathesis** | Python CLI | Auto-generate tests from OpenAPI spec |

## E2E / UI Testing

| Tool | Target | Key Trait |
|------|--------|-----------|
| **Playwright** | Web (Chromium, Firefox, WebKit) | Auto-wait, codegen, trace viewer |
| **Cypress** | Web (Chromium) | Time-travel debugging, component testing |
| **Selenium** | Web (all browsers) | Widest browser support, mature |
| **Appium** | Mobile (iOS, Android) | Cross-platform mobile automation |
| **Detox** | React Native | Gray-box, synchronization-aware |

## Performance Testing

| Tool | Language | Key Trait |
|------|----------|-----------|
| **k6** | JavaScript | Developer-friendly, Grafana integration |
| **JMeter** | Java/GUI | Visual test plans, wide protocol support |
| **Gatling** | Scala/Java | Code-based, excellent reports |
| **Locust** | Python | Python scripts, distributed load |

## Security Testing

| Tool | Category | What It Finds |
|------|----------|---------------|
| **SonarQube** | SAST | Code smells, bugs, vulnerabilities |
| **Semgrep** | SAST | Custom rules, multi-language |
| **CodeQL** | SAST | Deep data-flow analysis (GitHub) |
| **OWASP ZAP** | DAST | Runtime vulnerabilities in web apps |
| **Snyk** | Dependency | Known CVEs in dependencies |
| **Trivy** | Container/IaC | Image + infra vulnerabilities |
| **GitLeaks** | Secrets | Hardcoded secrets in git history |

## Contract Testing

| Tool | Approach | Ecosystem |
|------|----------|-----------|
| **Pact** | Consumer-driven contracts | Multi-language (JS, Java, Python, Go, .NET) |
| **Spring Cloud Contract** | Provider-driven | Java/Spring |
| **Schemathesis** | Schema-driven | OpenAPI/GraphQL |

## Mutation Testing

| Tool | Language | Approach |
|------|----------|----------|
| **Stryker** | JS/TS, .NET | Mutant generation + reporting |
| **PIT (pitest)** | Java/JVM | Bytecode mutation |
| **mutmut** | Python | AST-level mutation |
| **cargo-mutants** | Rust | Source-level mutation |

## BDD Frameworks

| Tool | Language | Syntax |
|------|----------|--------|
| **Cucumber** | Multi (Java, JS, Ruby) | Gherkin feature files |
| **Behave** | Python | Gherkin + Python steps |
| **SpecFlow** | .NET | Gherkin + C# steps |
| **Gauge** | Multi | Markdown specs + code |

## Visual Regression

| Tool | Approach | Integration |
|------|----------|-------------|
| **Percy** (BrowserStack) | Cloud screenshot comparison | CI/CD |
| **Chromatic** | Storybook visual review | Component-level |
| **Playwright screenshots** | Built-in `toHaveScreenshot()` | Self-hosted |

## Reporting & Management

| Tool | Type | Best For |
|------|------|----------|
| **Allure** | Report framework | Rich HTML reports, multi-framework |
| **ReportPortal** | AI-powered dashboard | Test analytics, flaky detection |
| **TestRail** | Test management | Manual + automated tracking |
| **Xray** (Jira) | Test management | Jira-native test planning |

## Chaos Engineering

| Tool | Target | Key Trait |
|------|--------|-----------|
| **Chaos Mesh** | Kubernetes | Pod/network/IO/time chaos |
| **Litmus** | Kubernetes | ChaosHub with pre-built experiments |
| **AWS Fault Injection** | AWS | Managed fault injection service |
| **Toxiproxy** | Network | Simulate network conditions (latency, partition) |
