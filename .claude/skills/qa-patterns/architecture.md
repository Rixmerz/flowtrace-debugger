# Test Architecture Patterns

## Test Pyramid

```
        /  E2E  \           ~10%  Slow, expensive, high confidence
       /----------\
      / Integration \       ~20%  Medium speed, real dependencies
     /----------------\
    /      Unit        \    ~70%  Fast, isolated, cheap
   /--------------------\
```

| Level | Scope | Speed | Dependencies | Typical Count |
|-------|-------|-------|--------------|---------------|
| **Unit** | Single function/class | <10ms | None (mocked) | Hundreds-thousands |
| **Integration** | Multiple components + real infra | 100ms-5s | DB, cache, queues | Dozens-hundreds |
| **E2E** | Full system through UI/API | 5-30s | Everything | 10-50 critical paths |

Invert the pyramid = slow feedback, flaky tests, high maintenance cost.

## Shift Left Testing

Move testing earlier in the development lifecycle:

```
Traditional:  Code -> Build -> Test -> Deploy -> Find bugs
Shift Left:   Design -> Code+Test -> Build+Scan -> Deploy+Monitor
```

Practices:
- Write tests before or alongside code (TDD)
- Static analysis in IDE (linting, type checking)
- Security scanning in PR, not post-deploy
- Contract tests during API design, not after integration
- Code review includes test review

## CI/CD Pipeline QA Stages

```
PR opened
  |
  v
[1. Lint + Format]     cargo fmt, eslint, ruff, gofmt
  |
  v
[2. Unit Tests]         pytest, vitest, go test -short
  |
  v
[3. Build]              Compile, bundle, Docker image
  |
  v
[4. Integration Tests]  TestContainers, real DB, API tests
  |
  v
[5. Security Scan]      SAST (Semgrep), deps (Snyk), secrets (GitLeaks)
  |
  v
[6. E2E Tests]          Playwright, Cypress (against staging)
  |
  v
[7. Performance]        k6 smoke test (baseline check)
  |
  v
[8. Quality Gate]       Coverage >= threshold, 0 critical issues
  |
  v
[9. Deploy]             Canary / Blue-green / Feature flag
  |
  v
[10. Smoke Tests]       Critical path verification in production
```

## Quality Gates -- Metrics and Thresholds

| Metric | Threshold | Blocks Deploy? |
|--------|-----------|----------------|
| Line coverage | >= 80% | Yes |
| Branch coverage | >= 70% | Yes |
| Critical SAST findings | 0 | Yes |
| High SAST findings | 0 new | Yes |
| E2E pass rate | 100% | Yes |
| Unit test pass rate | 100% | Yes |
| Dependency vulnerabilities (critical) | 0 | Yes |
| Performance regression | < 10% degradation | Yes |
| Flaky test rate | < 2% | No (alert) |
| Mutation score | >= 60% | No (informational) |

## Parallelization Strategies

### Matrix builds (CI)
```yaml
# GitHub Actions example
strategy:
  matrix:
    os: [ubuntu, macos, windows]
    node: [18, 20, 22]
    # Runs 9 combinations in parallel
```

### Test splitting
```
# Split by timing data (Playwright)
npx playwright test --shard=1/4
npx playwright test --shard=2/4

# Split by file (Jest)
jest --shard=1/3
```

### Parallel execution within runner
- **Vitest**: Parallel by default (worker threads)
- **pytest-xdist**: `pytest -n auto` (process-based)
- **Go**: `go test -parallel 8` (goroutine-based)
- **cargo-nextest**: Parallel test binaries

## Containerized Testing

```dockerfile
# Dockerfile.test -- isolated reproducible test environment
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run lint
RUN npm run test:unit
RUN npm run test:integration
# If all pass, image builds successfully
```

Benefits: Reproducible across machines, no "works on my machine", CI/local parity.

## Microservices Testing Strategy

```
Level 1: Unit Tests (per service)
  - Business logic, domain models
  - Mock all external calls

Level 2: Contract Tests (between services)
  - Consumer defines expected API shape (Pact)
  - Provider verifies it can fulfill contracts
  - No need for both services running simultaneously

Level 3: Integration Tests (per service + real infra)
  - Service + real DB (TestContainers)
  - Service + real message broker
  - Service + mocked downstream services (WireMock)

Level 4: E2E Tests (minimal, critical paths only)
  - 5-10 critical business flows across services
  - Run against staging environment
  - Keep minimal -- these are slow and flaky

Level 5: Chaos Engineering (production resilience)
  - Kill random pods, inject latency, partition networks
  - Verify graceful degradation
```

## API REST Testing Checklist

Per endpoint, verify:

| Category | Tests |
|----------|-------|
| **Happy path** | 200 OK with correct body, headers, content-type |
| **Not found** | 404 for non-existent resource |
| **Validation** | 400 for invalid input (missing fields, wrong types, boundary values) |
| **Authentication** | 401 for missing/invalid token |
| **Authorization** | 403 for insufficient permissions |
| **Conflict** | 409 for duplicate creation or version conflict |
| **Server error** | 500 handling (graceful error response, no stack traces) |
| **Pagination** | Correct page/limit/offset, empty last page, boundary |
| **Sorting/Filtering** | Correct order, filter combinations, edge cases |
| **Side effects** | DB state changed, events published, emails sent |
| **Idempotency** | PUT/DELETE return same result on retry |
| **Rate limiting** | 429 when limit exceeded |

## Frontend Testing Levels

```
Level 1: Component Unit Tests
  - Render with props, verify output
  - User interactions (click, type, select)
  - Framework: Vitest + Testing Library

Level 2: Integration with Mocked APIs
  - Multiple components interacting
  - MSW (Mock Service Worker) for API mocking
  - Test data flow through the component tree

Level 3: E2E Tests
  - Full app in browser
  - Real or staged backend
  - Framework: Playwright
  - Critical user journeys only

Level 4: Visual Regression
  - Screenshot comparison on PR
  - Component-level (Chromatic/Storybook)
  - Page-level (Percy, Playwright screenshots)
```

## Database Testing

| Test Type | What It Verifies | Tool |
|-----------|-----------------|------|
| **Migration tests** | Migrations run up/down cleanly | Framework migration tool |
| **Referential integrity** | FK constraints hold | Integration tests with real DB |
| **Index verification** | Queries use expected indexes | EXPLAIN ANALYZE assertions |
| **Data integrity** | Constraints (NOT NULL, UNIQUE, CHECK) | Insert invalid data, expect failure |
| **Seed data** | Required data exists after setup | Post-migration assertions |
| **Performance** | Query execution time within bounds | Benchmark queries with realistic data |

Best practice: Use TestContainers for a real DB instance per test suite. Transaction rollback per test for speed.
