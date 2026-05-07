---
name: qa-patterns
description: QA and testing reference - test strategy, patterns, coverage, CI/CD integration, and quality metrics. Language-agnostic. Use when designing test strategies, reviewing test quality, setting up CI/CD quality gates, or selecting testing tools.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|concepts|all]"
---

# QA & Testing Architecture Reference (2024-2025)

Comprehensive language-agnostic reference for testing and quality assurance decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For testing tools and frameworks by category, see [frameworks.md](frameworks.md)
- For testing design patterns (AAA, POM, TDD, anti-patterns), see [design-patterns.md](design-patterns.md)
- For test architecture (pyramid, CI/CD, quality gates, microservices), see [architecture.md](architecture.md)
- For best practices (naming, flaky tests, coverage, metrics), see [best-practices.md](best-practices.md)
- For testing concepts (performance, security, contract, chaos), see [testing-concepts.md](testing-concepts.md)

## Decision Framework

1. **Test Pyramid**: 70% unit / 20% integration / 10% E2E
2. **Unit framework**: Vitest (JS/TS), pytest (Python), JUnit 5 (Java), Go `testing`, Swift Testing, RSpec (Ruby), NUnit/xUnit (.NET)
3. **E2E/UI**: Playwright (web), Appium (mobile)
4. **Performance**: k6
5. **Contract testing**: Pact
6. **Security**: SonarQube (SAST), OWASP ZAP (DAST), Snyk (dependency scanning)
7. **Mutation testing**: Stryker (JS/TS/.NET), PIT (Java), mutmut (Python)
8. **BDD**: Cucumber (multi-language), Behave (Python), SpecFlow (.NET)

## Testing Approach Comparison

| Aspect | TDD | BDD | Exploratory |
|--------|-----|-----|-------------|
| **Who writes** | Developer | Dev + QA + PO | QA / Tester |
| **When** | Before code | Before/during feature | After feature |
| **Language** | Code (assertions) | Gherkin (Given/When/Then) | Session notes |
| **Primary value** | Design feedback, regression safety | Shared understanding, living docs | Find unexpected bugs |
| **Cost** | Medium (upfront investment) | High (3-layer translation) | Low (no automation) |
| **Best for** | Logic-heavy code, APIs | User-facing features, acceptance | Complex UX, edge cases |
| **Output** | Unit/integration tests | Executable specifications | Bug reports, test charters |

## Quality Maturity Levels

| Level | Description | Key Indicators |
|-------|-------------|----------------|
| **0 - Ad hoc** | No formal testing | Manual testing only, no CI |
| **1 - Reactive** | Some unit tests | Tests written after bugs, <30% coverage |
| **2 - Managed** | Consistent testing | CI pipeline, >60% coverage, test reviews |
| **3 - Proactive** | Quality-first | TDD, >80% coverage, quality gates, mutation testing |
| **4 - Optimized** | Continuous improvement | Metrics-driven, chaos engineering, shift-left security |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
