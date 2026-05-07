---
name: dev-patterns
description: Software development reference - design patterns, architecture patterns, CI/CD, cloud infrastructure, observability, security, and system design trade-offs. Language-agnostic. Use when making architectural decisions, designing systems, reviewing infrastructure, or evaluating technology choices.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|concepts|all]"
---

# Software Development Architecture Reference (2024-2025)

Comprehensive language-agnostic reference for architectural decisions, infrastructure, and system design. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For tools, CI/CD, containers, cloud, IaC, and observability, see [frameworks.md](frameworks.md)
- For design patterns (creational, structural, behavioral, distributed), see [design-patterns.md](design-patterns.md)
- For architecture patterns (hexagonal, microservices, CQRS, DDD, caching), see [architecture.md](architecture.md)
- For best practices (API, database, security, observability, code quality), see [best-practices.md](best-practices.md)
- For system design concepts (CAP, polyglot persistence, AI patterns, trends), see [language-features.md](language-features.md)

## Decision Framework

| Decision | Option A | Option B | Choose A when | Choose B when |
|----------|----------|----------|---------------|---------------|
| **Communication** | REST/gRPC (sync) | Messaging (async) | Need immediate response, simple flow | Fire-and-forget, decoupled services, spikes |
| **Persistence** | SQL (PostgreSQL, MySQL) | NoSQL (MongoDB, DynamoDB) | Complex relations, ACID, ad-hoc queries | Flexible schema, massive scale, key-value |
| **Deploy** | Monolith | Microservices | Small team, early product, shared DB | Large org, independent deploy, polyglot |
| **Consistency** | Strong (ACID) | Eventual | Financial, inventory, user auth | Social feeds, analytics, recommendations |
| **Cache** | In-process (local) | Distributed (Redis) | Single instance, low latency | Multiple instances, shared state |
| **Auth** | JWT stateless | Sessions (server-side) | Stateless APIs, microservices | Need immediate revocation, simple setup |
| **API style** | REST | GraphQL | Simple CRUD, caching, broad tooling | Diverse clients, deep nested data, mobile |

## Architecture Maturity Progression

```
Stage 1: MONOLITH
  Single deployable unit. Shared database.
  Best for: MVPs, small teams (1-5 devs), proving product-market fit.
  Risk: Coupling grows, deploys slow down, scaling is all-or-nothing.

  |
  v  When modules are well-defined and team grows to 5-15

Stage 2: MODULAR MONOLITH
  Single deployable, but strict internal module boundaries.
  Modules communicate via internal APIs/events, not direct DB access.
  Best for: Medium teams, clear domain boundaries, not ready for distributed systems.
  Risk: Temptation to cross module boundaries "just this once."

  |
  v  When independent scaling/deployment per module is needed

Stage 3: MICROSERVICES
  Independent services, own databases, async communication.
  Best for: Large orgs (15+ devs), high scale, polyglot needs.
  Risk: Distributed system complexity (network failures, eventual consistency, observability).
```

Rule: Never start with microservices unless you have the team, tooling, and operational maturity to support them.

## Supporting Files

| File | Contents |
|------|----------|
| `frameworks.md` | Version control, CI/CD, containers, cloud, IaC, observability, security tools |
| `design-patterns.md` | Creational, structural, behavioral, distributed patterns (pseudocode) |
| `architecture.md` | Hexagonal, microservices, event-driven, CQRS, DDD, caching strategies |
| `best-practices.md` | API design, database, security, observability, concurrency, code quality, ADRs |
| `language-features.md` | CAP theorem, SQL vs NoSQL, polyglot persistence, AI patterns, 2024-2025 trends |

## Related Skills
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
