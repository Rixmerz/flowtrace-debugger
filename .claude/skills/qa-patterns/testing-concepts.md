# Testing Concepts & Specialized Testing Types

## Testing in Microservices

### Contract Testing Flow
```
Consumer Service                          Provider Service
     |                                          |
     |  1. Write consumer test                  |
     |  2. Generate Pact file (contract)        |
     |         |                                |
     |         +--- Pact Broker (shared) ------>|
     |                                          |
     |                         3. Provider verifies contract
     |                         4. Publish verification result
     |                                          |
     +<--- Both sides verified independently ---+
```

Key: Services never need to run simultaneously. Each side verifies independently against the contract.

### Async Messaging Testing
```
// Testing event consumers: publish event, poll for result

test "order.created event triggers inventory reservation":
    publish("order.created", { orderId: 123, items: [...] })

    // Poll with timeout instead of sleep
    reservation = awaitCondition(
        check: () => inventoryDB.findReservation(orderId: 123),
        timeout: 5s,
        interval: 200ms
    )

    assert reservation.status == "reserved"
    assert reservation.items.length == 2
```

Never use `sleep()` -- use polling with explicit timeout (Awaitility in Java, `poll_for` patterns in other languages).

## Performance Testing Types

| Type | Goal | Load Pattern | Duration |
|------|------|-------------|----------|
| **Load** | Verify under expected traffic | Ramp to target users | 15-60 min |
| **Stress** | Find breaking point | Ramp beyond capacity | Until failure |
| **Spike** | Verify sudden traffic handling | Instant jump to peak | 5-10 min |
| **Soak** | Find memory leaks, degradation | Constant moderate load | 4-24 hours |
| **Scalability** | Measure throughput vs resources | Incremental scaling | Variable |

### k6 Example
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '2m', target: 100 },   // ramp up
        { duration: '5m', target: 100 },   // sustain
        { duration: '2m', target: 0 },     // ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<500'],   // 95th percentile < 500ms
        http_req_failed: ['rate<0.01'],      // < 1% error rate
    },
};

export default function () {
    const res = http.get('https://api.example.com/users');
    check(res, {
        'status is 200': (r) => r.status === 200,
        'response time < 500ms': (r) => r.timings.duration < 500,
    });
    sleep(1);
}
```

## Security Testing Types

| Type | When | What It Does | Tools |
|------|------|-------------|-------|
| **SAST** (Static) | CI/PR | Analyze source code for vulnerabilities | SonarQube, Semgrep, CodeQL |
| **DAST** (Dynamic) | Staging | Probe running app for vulnerabilities | OWASP ZAP, Burp Suite |
| **Dependency Scan** | CI/daily | Check deps for known CVEs | Snyk, Trivy, Dependabot |
| **Secrets Scan** | Pre-commit/CI | Detect hardcoded credentials | GitLeaks, TruffleHog |
| **Container Scan** | Build | Scan Docker images for vulnerabilities | Trivy, Grype |
| **IaC Scan** | CI | Check infra code for misconfigurations | Checkov, tfsec |
| **Pen Testing** | Quarterly | Manual security testing by experts | Manual + tools |

## OWASP Top 10 (2021) Testing Checklist

| # | Category | What to Test |
|---|----------|-------------|
| A01 | **Broken Access Control** | IDOR, privilege escalation, missing auth on endpoints |
| A02 | **Cryptographic Failures** | Weak algorithms, plaintext storage, missing TLS |
| A03 | **Injection** | SQL, NoSQL, OS command, LDAP, XSS injection |
| A04 | **Insecure Design** | Business logic flaws, missing rate limits, abuse cases |
| A05 | **Security Misconfiguration** | Default credentials, verbose errors, unnecessary features |
| A06 | **Vulnerable Components** | Outdated dependencies with known CVEs |
| A07 | **Auth Failures** | Brute force, weak passwords, session fixation |
| A08 | **Data Integrity Failures** | Insecure deserialization, unsigned updates |
| A09 | **Logging Failures** | Missing audit logs, no alerting on attacks |
| A10 | **SSRF** | Server-side requests to internal resources |

## Other Testing Types

### Smoke Testing
Quick verification that critical functionality works after deployment.
- 5-10 tests covering login, main page load, core API health
- Run immediately after deploy, before routing traffic
- Fail = instant rollback

### Regression Testing
Verify that new changes don't break existing functionality.
- Full test suite run on every PR/merge
- Prioritize by risk: recently changed areas, core features
- Automated: unit + integration + E2E suite

### Exploratory Testing
Structured manual testing guided by charters, not scripts.
```
Charter: "Explore payment flow with unusual currencies and amounts"
Time box: 45 minutes
Focus: Edge cases the automated tests might miss
Output: Bug reports, new test ideas, risk assessment
```

### Accessibility Testing (a11y)
| Tool | Type | What It Checks |
|------|------|---------------|
| **axe-core** | Automated | WCAG 2.1 violations |
| **Lighthouse** | Automated | Accessibility score + audit |
| **Pa11y** | CI integration | Automated a11y in pipeline |
| **Screen reader** | Manual | VoiceOver, NVDA real-world testing |

Key checks: keyboard navigation, color contrast, alt text, ARIA roles, focus management.

### Visual Regression Testing
```
1. Capture baseline screenshots (golden images)
2. Run tests, capture new screenshots
3. Pixel-diff comparison
4. Flag differences for human review
5. Accept or reject changes
```
Tools: Playwright `toHaveScreenshot()`, Percy, Chromatic.

### Mutation Testing
See [best-practices.md](best-practices.md#mutation-testing) for details.

## Chaos Engineering

### Principles
1. **Define steady state**: What does "healthy" look like? (latency, error rate, throughput)
2. **Hypothesize**: "If X fails, the system should degrade gracefully"
3. **Introduce failure**: Kill pods, inject latency, partition network
4. **Observe**: Did the system maintain steady state?
5. **Fix**: Address any unexpected failures

### Common Experiments

| Experiment | What It Tests | Tool |
|-----------|---------------|------|
| Pod kill | Service restart, self-healing | Chaos Mesh, kill -9 |
| Network partition | Circuit breaker, timeout handling | Toxiproxy, Chaos Mesh |
| Latency injection | Timeout configuration, fallbacks | Toxiproxy, Istio fault injection |
| CPU/memory stress | Resource limits, autoscaling | stress-ng, Chaos Mesh |
| DNS failure | Retry logic, caching | Chaos Mesh |
| Clock skew | Time-dependent logic | Chaos Mesh |

### When to Start
- After you have comprehensive monitoring and alerting
- After integration tests cover happy paths
- Start in staging, graduate to production with blast radius limits

## AI-Assisted Testing (2024-2025 Trends)

| Capability | Tools/Approaches | Maturity |
|-----------|-----------------|----------|
| **Test generation** | LLM-based from code/specs | Early (useful for boilerplate) |
| **Flaky test detection** | ML on test history | Production-ready (ReportPortal) |
| **Visual testing** | AI-powered screenshot diff | Production-ready (Percy, Applitools) |
| **Test prioritization** | Risk-based selection from code changes | Growing (Launchable) |
| **Root cause analysis** | Correlate failures with code changes | Early |
| **API fuzzing** | Schema-aware random input generation | Production-ready (Schemathesis) |

## Observability as Testing Complement

Testing verifies expected behavior. Observability catches unexpected behavior in production.

| Pillar | Tool Examples | Testing Complement |
|--------|-------------|-------------------|
| **Logs** | ELK, Loki, CloudWatch | Verify error logs in integration tests |
| **Metrics** | Prometheus, Datadog | Performance test thresholds |
| **Traces** | Jaeger, Tempo | Verify request flow in E2E tests |
| **Alerts** | PagerDuty, OpsGenie | Smoke tests trigger alert verification |

The feedback loop: Tests prevent known bugs. Observability detects unknown bugs. Production bugs become new tests (regression).
