# Go Frameworks Reference

## Web & API

| Framework | Stars | Key Trait | When to Use |
|-----------|-------|-----------|-------------|
| **net/http (stdlib 1.22+)** | — | Method patterns + wildcards in ServeMux | Low-medium complexity, stdlib-first |
| **Gin** | ~81K | 48% adoption, radix tree, 40x Martini | Default for REST APIs, mature middleware |
| **Echo** | ~30K | Zero dynamic allocs, 16% adoption | Enterprise APIs, API gateways |
| **Chi** | ~18K | 100% net/http compatible, no deps | Advanced routing without leaving stdlib |
| **Fiber** | ~35K | Express-like, fasthttp (NOT net/http) | Node.js migrants, raw perf over compat |
| **Huma** | ~2.5K | Router-agnostic, auto OpenAPI 3.1 | API-first design with auto docs |
| **gorilla/mux** | ~21K | Archived 2022, restored 2023, declining | Legacy projects only |

## Database & ORM

| Library | Approach | Best For |
|---------|----------|----------|
| **pgx v5** | Pure PG driver, binary protocol, pgxpool | PostgreSQL perf (300% faster inserts than sqlx) |
| **sqlc** | SQL-first, generates Go code, zero runtime overhead | Teams comfortable with SQL wanting type-safety |
| **GORM** | Full ORM, code-first, auto-migration | Rapid prototyping, small-medium apps |
| **sqlx** | Lightweight database/sql extension | Multi-database projects |
| **ent** | Code-first with codegen, compile-time checks | Complex data models with graph relations |

## Caching

| Library | Key Trait | Best For |
|---------|-----------|----------|
| **Ristretto v2** | TinyLFU + SampledLFU, best hit ratios, generics | In-memory cache (preferred over BigCache) |
| **go-redis v9** | Type-safe, pipelining, pub/sub, OTel | Distributed caching with Redis |
| **BigCache** | Minimal GC pressure, []byte storage | High-throughput, global TTL only |

## Testing

- **testing (stdlib)**: Unit tests, benchmarks, fuzzing (1.18+), sub-tests, parallel tests
- **testify** (27% adoption): `assert`, `require`, `mock`, `suite`
- **uber-go/mock**: Replaces archived Google gomock. Interface-based mock generation
- **mockery v3**: Auto-generates testify/mock implementations
- **go-cmp** (Google): Powerful value comparison with custom comparers

## Messaging & Events

| Library | Key Trait | Best For |
|---------|-----------|----------|
| **franz-go** | 2.5x faster produce, 1.5x faster consume vs Sarama | New Kafka projects |
| **Sarama** (IBM) | Historically most used Kafka client | Existing Kafka projects |
| **Watermill** | Pub/Sub abstraction over Kafka/NATS/RabbitMQ/etc. | Event-driven arch, broker independence |
| **NATS Go Client** | JetStream, KV store, object store | Simpler deployments than Kafka |

## Logging

| Logger | Allocs/op | When to Use |
|--------|-----------|-------------|
| **log/slog** (stdlib 1.21+) | 0 | New projects (stdlib, future-proof) |
| **zerolog** | 0 | Fastest, zero-alloc JSON logging |
| **zap** (Uber) | 3 | Highly customizable via zapcore |
| logrus | — | **Maintenance mode — avoid for new projects** |

## DI

| Approach | Runtime Cost | Best For |
|----------|-------------|----------|
| **Manual/Pure DI** | 0 | Most projects (idiomatic Go) |
| **Google Wire** | ~0.3 ns/op (codegen) | Small-medium needing DI without runtime cost |
| **Uber Fx** | ~152K ns/op (reflection) | Enterprise with lifecycle management |

## CLI, Validation, Templating, Observability

- **Cobra** (~39K stars): CLI standard (kubectl, Hugo, Docker CLI, gh)
- **go-playground/validator v10**: Struct validation via tags
- **templ**: Type-safe HTML templating compiled to Go. **Go + templ + HTMX** growing trend
- **OpenTelemetry Go SDK**: Vendor-agnostic traces, metrics, logs
- **protobuf/gRPC**: Standard for service-to-service communication
