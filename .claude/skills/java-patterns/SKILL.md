---
name: java-patterns
description: Java architecture reference - frameworks, design patterns, enterprise architecture, and production best practices for Java 17/21/23-24 (2024-2025). Use when making architectural decisions, reviewing Java code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Java Architecture Reference (2024-2025)

Comprehensive reference for Java architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework/library selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (singleton, builder, strategy, observer), see [design-patterns.md](design-patterns.md)
- For architecture patterns (hexagonal, CQRS, DDD, event-driven), see [architecture.md](architecture.md)
- For best practices (error handling, streams, concurrency, DO/DON'T), see [best-practices.md](best-practices.md)
- For language features (records, sealed classes, virtual threads, pattern matching), see [language-features.md](language-features.md)

## Decision Framework

1. **Enterprise backend**: Default -> Spring Boot 3.x. Cloud-native/GraalVM -> Quarkus. Compile-time DI -> Micronaut
2. **Persistence**: Default ORM -> Hibernate/Spring Data JPA. Type-safe SQL -> jOOQ. Lightweight -> MyBatis
3. **Testing**: Default -> JUnit 5 + Mockito. Integration -> TestContainers. Assertions -> AssertJ
4. **Messaging**: Kafka -> Spring Kafka. AMQP -> Spring AMQP. Integration routing -> Apache Camel
5. **Build tool**: Enterprise/complex -> Maven. Flexible/incremental -> Gradle (Kotlin DSL)
6. **Observability**: Metrics -> Micrometer. Distributed tracing -> OpenTelemetry. Resilience -> Resilience4j
7. **Security**: Default -> Spring Security 6.x. Identity provider -> Keycloak

## Java in Production

| Company | Result |
|---------|--------|
| **Netflix** | Microservices backbone, Spring-based platform serving 260M+ subscribers |
| **Uber** | Backend services handling millions of trips/day, custom Java frameworks |
| **LinkedIn** | Apache Kafka (written in Java/Scala), processes trillions of messages/day |
| **Amazon** | AWS SDK for Java, core services, Lambda runtime |
| **Goldman Sachs** | Low-latency trading systems, Eclipse Collections contributor |
| **Airbnb** | Backend services, migrated key services from Ruby to Java |
| **Twitter/X** | JVM-based infrastructure serving 500M+ tweets/day |

## Java Evolution

| Version | Key Features |
|---------|-------------|
| Java 17 (LTS) | Records, Sealed Classes, Pattern Matching instanceof, Text Blocks, Switch Expressions |
| Java 21 (LTS) | Virtual Threads, Pattern Matching Switch, Record Patterns, Sequenced Collections |
| Java 22 | Unnamed Variables (`_`), Statements before `super()` (preview) |
| Java 23 | Primitive types in Patterns (preview), Markdown doc comments, Module imports (preview) |
| Java 24 | Structured Concurrency (preview), Scoped Values (preview), Stream Gatherers (preview) |

LTS releases (17, 21) are production defaults. Non-LTS (22, 23, 24) for early adoption of preview features.

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
