# Best Practices (Language-Agnostic)

## API Design (REST)

### URL Conventions
```
GET    /api/v1/users              # List users
GET    /api/v1/users/42           # Get user 42
POST   /api/v1/users              # Create user
PUT    /api/v1/users/42           # Replace user 42
PATCH  /api/v1/users/42           # Partial update user 42
DELETE /api/v1/users/42           # Delete user 42

GET    /api/v1/users/42/orders    # List orders for user 42
```

Rules:
- Plural nouns for resources (`/users`, not `/user`)
- Version in URL (`/api/v1/`) or header (`Accept: application/vnd.api.v1+json`)
- Use query params for filtering, sorting, pagination: `?status=active&sort=-created_at&page=2&limit=20`
- Verbs in URL only for actions that are not CRUD: `POST /api/v1/orders/42/cancel`

### Consistent Response Format
```
// Success
{
  "data": { "id": 42, "name": "Alice" },
  "meta": { "request_id": "req_abc123" }
}

// Collection
{
  "data": [...],
  "meta": { "total": 150, "page": 2, "limit": 20 }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": [{ "field": "email", "reason": "required" }]
  },
  "meta": { "request_id": "req_abc123" }
}
```

### Idempotency
- GET, PUT, DELETE are naturally idempotent
- POST: use `Idempotency-Key` header for critical operations
- Client sends unique key, server deduplicates within a window

### HTTP Status Codes (Use Correctly)
| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST that creates a resource |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation error, malformed input |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Authenticated but insufficient permissions |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Duplicate, version conflict |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unhandled server error |

## Database Best Practices

### Migrations
- Always use versioned migration files (never manual DDL)
- Each migration has `up` and `down` (rollback)
- Run migrations in CI to catch errors early
- Never modify a migration that has been applied to production

### Zero-Downtime Migrations (Expand-Contract)
```
Phase 1 (Expand): Add new column, keep old column
  ALTER TABLE users ADD COLUMN full_name TEXT;
  -- Deploy code that writes to BOTH columns

Phase 2 (Migrate): Backfill data
  UPDATE users SET full_name = first_name || ' ' || last_name WHERE full_name IS NULL;

Phase 3 (Contract): Remove old columns
  -- Deploy code that reads only from full_name
  ALTER TABLE users DROP COLUMN first_name, DROP COLUMN last_name;
```

Never: rename columns, change types, or drop columns in a single deploy.

### Indexing
- Index columns used in WHERE, JOIN, ORDER BY
- Composite indexes: column order matters (most selective first)
- Don't over-index: each index slows writes
- Use `EXPLAIN ANALYZE` to verify query plans
- Partial indexes for filtered queries: `CREATE INDEX ON orders(status) WHERE status = 'pending'`

### Connection Pooling
- Always use connection pools (PgBouncer, HikariCP, SQLAlchemy pool)
- Size formula: `pool_size = (core_count * 2) + effective_spindle_count`
- Set connection timeout, idle timeout, max lifetime
- Monitor pool exhaustion in metrics

### Soft Delete
```
-- Instead of DELETE
UPDATE users SET deleted_at = NOW() WHERE id = 42;

-- Queries automatically filter
SELECT * FROM users WHERE deleted_at IS NULL;
```

Trade-off: Keeps audit trail but complicates queries. Use when regulatory/compliance requires it.

## Security Best Practices

### Transport
- HTTPS everywhere (no exceptions)
- HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- TLS 1.2 minimum, prefer 1.3

### Authentication
- JWT with short expiration (15 min) + refresh tokens (7 days)
- Store refresh tokens server-side (revocable)
- Never store JWTs in localStorage (XSS risk) -- use httpOnly cookies
- Always set `exp` claim on JWTs

### Authorization
- Principle of Least Privilege: grant minimum permissions needed
- RBAC (Role-Based) for simple models, ABAC (Attribute-Based) for complex
- Always validate permissions server-side (never trust client)

### Input & Output
- Validate ALL input server-side (client validation is UX, not security)
- Parameterized queries (never string concatenation for SQL)
- Sanitize output to prevent XSS
- CORS: specify exact origins, never `*` for APIs handling sensitive data

### Secrets
- Never hardcode secrets in source code
- Use secrets management (Vault, AWS Secrets Manager, Azure Key Vault)
- Rotate secrets regularly
- Never log sensitive data (tokens, passwords, PII)
- Use `.env` files for local dev only, never commit them

### Rate Limiting
- Apply to all public endpoints
- Use token bucket or sliding window algorithm
- Return `429 Too Many Requests` with `Retry-After` header
- Rate limit by API key, IP, or user ID

## Observability Best Practices

### Structured Logging
```
// BAD: unstructured
log("User 42 placed order 789 for $150.00")

// GOOD: structured JSON
log({
  "level": "info",
  "event": "order.placed",
  "user_id": 42,
  "order_id": 789,
  "amount": 150.00,
  "currency": "USD",
  "correlation_id": "req_abc123",
  "timestamp": "2025-01-15T10:30:00Z"
})
```

Rules:
- Always JSON format in production
- Include correlation ID (trace ID) in every log
- Log at appropriate levels: DEBUG (dev only), INFO (business events), WARN (recoverable), ERROR (failures)
- Never log sensitive data (passwords, tokens, PII)

### Health Checks
```
GET /health/live    -> 200 if process is running (liveness)
GET /health/ready   -> 200 if service can handle requests (readiness)
                       503 if DB down, cache unreachable, etc.
```

Kubernetes uses liveness to restart pods, readiness to remove from load balancer.

### Alerting
- Alert on SLO violations, not individual errors
- Use error budget burn rate (Google SRE approach)
- Golden signals: latency, traffic, errors, saturation
- No high-cardinality labels in metrics (no `user_id` in Prometheus labels)
- Every alert must have a runbook

### Correlation IDs
- Generate at API gateway / first service
- Propagate through all downstream calls (HTTP header, message metadata)
- Include in all logs and traces
- Standard header: `X-Request-ID` or `traceparent` (W3C Trace Context)

## Concurrency Best Practices

- **Prefer immutability:** Immutable data eliminates data races entirely
- **Use high-level primitives:** Channels, actors, async/await over raw mutexes/locks
- **Idempotency:** Design operations to be safely retryable
- **Explicit timeouts:** Every remote call, every lock acquisition, every queue read
- **Backpressure:** Reject or slow down producers when consumers cannot keep up
- **Exponential backoff + jitter:** For retries. `delay = min(base * 2^attempt + random_jitter, max_delay)`
- **Graceful shutdown:** Handle SIGTERM, drain connections, finish in-flight requests
- **Circuit breakers:** Prevent cascading failures from slow/failing dependencies

## Code Quality

### Naming
- Intention-revealing names: `isEligibleForDiscount()` not `check()`
- Consistent vocabulary: pick `get/fetch/retrieve` and stick with one
- No abbreviations unless universally understood (`id`, `url`, `http`)

### Functions
- Small, single-responsibility (one reason to change)
- Limit parameters (3-4 max; use objects for more)
- Return early for guard clauses (avoid deep nesting)
- Pure functions where possible (same input = same output, no side effects)

### Code Review Focus
- **Architecture:** Does it fit the existing patterns? Right layer?
- **Edge cases:** Null, empty, boundary values, concurrency?
- **Security:** Input validation, auth checks, no secrets in code?
- **Naming:** Clear, consistent, intention-revealing?
- **Tests:** Meaningful assertions, not just coverage?
- Don't bikeshed on style -- automate formatting with tools

### Rules
- Automate linting and formatting in CI (zero debate on style)
- Feature flags for incomplete features (never long-lived branches)
- No TODOs without linked tickets
- No magic numbers -- use named constants
- No commented-out code -- delete it (VCS remembers)
- No God Objects -- if a class has 20+ methods, split it
- No circular dependencies between modules

## Architecture Decision Records (ADR)

Document significant architectural decisions for posterity.

```
# ADR-001: Use PostgreSQL as Primary Database

## Status
Accepted

## Context
We need a relational database for our order management system.
We considered PostgreSQL, MySQL, and DynamoDB.

## Decision
We will use PostgreSQL 16.

## Reasons
- JSONB for flexible attributes alongside relational data
- Strong ecosystem (PostGIS, pg_trgm, TimescaleDB)
- Team has existing expertise
- Excellent replication and partitioning

## Consequences
- Need to manage connection pooling (PgBouncer)
- Horizontal sharding will require Citus or application-level partitioning
- Team needs to learn PostgreSQL-specific features

## Alternatives Considered
- MySQL: Less JSON support, weaker extension ecosystem
- DynamoDB: No ad-hoc queries, vendor lock-in, no ACID across items
```

Store ADRs in `docs/adr/` or `docs/decisions/`. Number sequentially. Never delete -- mark superseded ADRs as `Superseded by ADR-NNN`.
