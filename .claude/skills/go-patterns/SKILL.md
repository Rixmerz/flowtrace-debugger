---
name: go-patterns
description: Go architecture reference - frameworks, concurrency patterns, design patterns, cloud-native infrastructure, and production best practices for 2024-2025. Use when making architectural decisions, reviewing Go code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|concurrency|patterns|architecture|all]"
---

# Go Architecture Reference (2024-2025)

Comprehensive reference for Go architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework selection and comparisons, see [frameworks.md](frameworks.md)
- For concurrency patterns (goroutines, channels, pipelines, worker pools), see [concurrency.md](concurrency.md)
- For design patterns (functional options, error handling, composition), see [design-patterns.md](design-patterns.md)
- For architecture patterns (Clean, Hexagonal, Vertical Slice, DDD), see [architecture.md](architecture.md)
- For best practices (error handling, testing, project layout, linting), see [best-practices.md](best-practices.md)

## Decision Framework

When asked to choose between options, evaluate:

1. **Stdlib first**: Can `net/http` + `slog` + `testing` solve it? Start there
2. **Complexity**: Low -> stdlib/Chi. Medium -> Gin/Echo. High -> Huma
3. **Database**: PostgreSQL -> pgx + sqlc. Multi-DB -> sqlx. Rapid proto -> GORM
4. **Messaging**: Simple -> NATS. Enterprise Kafka -> franz-go. Broker-agnostic -> Watermill
5. **DI**: Small -> manual. Medium -> Wire. Enterprise lifecycle -> Fx
6. **Caching**: Local -> Ristretto. Distributed -> go-redis

## Modern Idiomatic Stack (2025)

**Replacing:** GORM + logrus + gorilla/mux
**With:** sqlc + pgx + slog + chi

## Go Evolution

| Version | Key Features |
|---------|-------------|
| 1.22 (Feb 2024) | HTTP method patterns in ServeMux, range over int, loop var scoping fix |
| 1.23 (Aug 2024) | Range-over-func (iterators), `unique` package, Timer/Ticker fixes |
| 1.24 (Feb 2025) | Generic type aliases, Swiss Tables maps (80% faster), `weak.Pointer[T]`, `testing.B.Loop` |
| 1.25 (Aug 2025) | Container-aware GOMAXPROCS, Green Tea GC, Flight Recorder, encoding/json/v2 experimental |

## Go in Production

| Company | Scale |
|---------|-------|
| **Uber** | ~2100 services, ~90M lines |
| **Google** | Internal infra, GKE, Cloud Run |
| **Cloudflare** | 12% of all automated API requests |
| **ByteDance/TikTok** | 70% of microservices |
| **Docker/Kubernetes** | Entire container ecosystem |
| **HashiCorp** | Terraform, Vault, Consul, Nomad |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
