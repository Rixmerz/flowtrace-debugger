# Java Frameworks & Libraries Reference

## Web / Backend

| Framework | Version | Key Trait | When to Use |
|-----------|---------|-----------|-------------|
| **Spring Boot** | 3.3.x | Batteries-included, massive ecosystem, auto-config | Default for enterprise projects |
| **Quarkus** | 3.x | GraalVM native, fast startup, reactive-first | Cloud-native, serverless, containers |
| **Micronaut** | 4.x | Compile-time DI, low memory, ahead-of-time | Microservices with fast cold starts |
| **Helidon** | 4.x | Virtual Threads native (Nima), Oracle-backed | Lightweight, Project Loom-first |
| **Jakarta EE** | 10/11 | Standards-based, vendor-neutral specs | Legacy enterprise, app servers |

## Persistence

| Library | Approach | Best For |
|---------|----------|----------|
| **Hibernate** 6.x | Full ORM, JPA provider, lazy loading, caching | Complex domain models |
| **Spring Data JPA** | Repository abstraction over Hibernate | CRUD-heavy apps, rapid development |
| **jOOQ** 3.x | Type-safe SQL DSL, code-gen from schema | Complex queries, SQL-first |
| **MyBatis** 3.x | SQL mapping, XML or annotation-based | Hand-tuned SQL, migration from legacy |
| **Flyway** / **Liquibase** | Schema migration | Every project needs one |

## Testing

| Library | Purpose | Notes |
|---------|---------|-------|
| **JUnit 5** | Test framework | Standard, `@ParameterizedTest`, `@Nested` |
| **Mockito** 5.x | Mocking | `@Mock`, `@InjectMocks`, `when().thenReturn()` |
| **TestContainers** | Integration testing | Real DB/Kafka/Redis in Docker containers |
| **AssertJ** | Fluent assertions | `assertThat(list).hasSize(3).contains("a")` |
| **Awaitility** | Async testing | Polling assertions for eventual consistency |
| **ArchUnit** | Architecture testing | Enforce layer dependencies at test time |

## Security

| Library | Purpose | Notes |
|---------|---------|-------|
| **Spring Security** 6.x | Auth framework | OAuth2, OIDC, SAML, method-level security |
| **Keycloak** | Identity provider | SSO, user federation, admin console |
| **JJWT** (jjwt) | JWT handling | Create/parse/validate JWTs |
| **Bouncy Castle** | Cryptography | Comprehensive crypto provider |

## Messaging / Event Streaming

| Library | Protocol | Notes |
|---------|----------|-------|
| **Spring Kafka** | Apache Kafka | Producer/consumer, streams, template |
| **Spring AMQP** | RabbitMQ | Template, listener containers |
| **Apache Camel** | Multi-protocol | Enterprise Integration Patterns, 300+ connectors |
| **SmallRye Reactive Messaging** | Multi-protocol | Quarkus/Micronaut reactive messaging |

## Observability

| Library | Purpose | Notes |
|---------|---------|-------|
| **Micrometer** | Metrics facade | Prometheus, Datadog, CloudWatch backends |
| **OpenTelemetry Java Agent** | Distributed tracing | Auto-instrumentation, zero-code setup |
| **Resilience4j** | Fault tolerance | Circuit breaker, retry, rate limiter, bulkhead |
| **SLF4J** + **Logback** | Logging | Standard facade + implementation |

## Utilities

| Library | Purpose | Notes |
|---------|---------|-------|
| **Lombok** | Boilerplate reduction | `@Data`, `@Builder`, `@Slf4j` (compile-time) |
| **MapStruct** | Object mapping | Compile-time DTO mapping, type-safe |
| **Guava** | Collections + utilities | Immutable collections, caching, hashing |
| **Jackson** | JSON serialization | Standard for REST APIs, annotations |
| **Apache Commons** | Utility libraries | Lang, IO, Collections, Text |
| **Vavr** | Functional programming | Immutable collections, pattern matching, Try |

## Build Tools

| Tool | Config Format | When to Use |
|------|--------------|-------------|
| **Maven** | XML (pom.xml) | Enterprise standard, reproducible, mature |
| **Gradle** | Kotlin DSL (build.gradle.kts) | Flexible, incremental builds, Android |

## AI / ML

| Library | Purpose | Notes |
|---------|---------|-------|
| **LangChain4j** | LLM integration | Chains, agents, RAG, tool calling |
| **Semantic Kernel for Java** | AI orchestration | Microsoft-backed, planner, memory |
| **Deep Java Library** (DJL) | ML inference | Framework-agnostic, PyTorch/TF/MXNet |
| **Spring AI** | AI abstraction | Spring-native, model-agnostic |
