# Architecture Patterns

## Hexagonal Architecture (Ports & Adapters)

Isolates business logic from infrastructure. The domain knows nothing about databases, HTTP, or external services.

```
                    ┌─────────────────────────────┐
   Driving          │         Application          │         Driven
   Adapters         │                             │         Adapters
                    │    ┌───────────────────┐    │
  ┌──────────┐      │    │                   │    │      ┌──────────┐
  │ REST API │──Port──>  │   Domain Logic    │  ──Port──>│ Database │
  └──────────┘      │    │   (Use Cases)     │    │      └──────────┘
  ┌──────────┐      │    │                   │    │      ┌──────────┐
  │   CLI    │──Port──>  │   Entities        │  ──Port──>│  Cache   │
  └──────────┘      │    │   Value Objects   │    │      └──────────┘
  ┌──────────┐      │    │                   │    │      ┌──────────┐
  │  gRPC    │──Port──>  │                   │  ──Port──>│ Message  │
  └──────────┘      │    └───────────────────┘    │      │  Broker  │
                    │                             │      └──────────┘
                    └─────────────────────────────┘
```

**Rules:**
- Domain layer has ZERO infrastructure imports
- Ports are interfaces defined by the domain
- Adapters implement ports (can be swapped: Postgres -> MySQL, REST -> gRPC)
- Dependencies point inward (adapters depend on domain, never the reverse)

**Directory structure:**
```
src/
  domain/              # Entities, value objects, domain services, port interfaces
  application/         # Use cases, orchestration, DTOs
  adapters/
    driving/           # REST controllers, CLI handlers, gRPC services
    driven/            # Database repos, cache clients, message publishers
  config/              # Dependency wiring, configuration
```

## Clean Architecture

Concentric layers with dependency rule: inner layers never reference outer layers.

```
┌─────────────────────────────────────────────┐
│  Frameworks & Drivers (DB, Web, UI, Devices)│
│  ┌─────────────────────────────────────┐    │
│  │  Interface Adapters (Controllers,   │    │
│  │  Gateways, Presenters)              │    │
│  │  ┌─────────────────────────────┐    │    │
│  │  │  Application (Use Cases)    │    │    │
│  │  │  ┌─────────────────────┐    │    │    │
│  │  │  │  Entities (Domain)  │    │    │    │
│  │  │  └─────────────────────┘    │    │    │
│  │  └─────────────────────────────┘    │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

| Layer | Contains | Depends On |
|-------|----------|------------|
| **Entities** | Business rules, domain models | Nothing |
| **Use Cases** | Application-specific business rules | Entities |
| **Interface Adapters** | Controllers, presenters, gateways | Use Cases, Entities |
| **Frameworks** | DB, web framework, UI, external APIs | Everything above |

## Microservices

### Core Principles
- Single responsibility per service (bounded context)
- Own your data (each service has its own database)
- Communicate via well-defined APIs (REST, gRPC, events)
- Independent deployment and scaling
- Failure isolation (one service down does not cascade)

### Essential Patterns

| Pattern | Purpose | Implementation |
|---------|---------|----------------|
| **API Gateway** | Single entry point, routing, auth, rate limiting | Kong, AWS API Gateway, Envoy |
| **Service Discovery** | Dynamic service location | Consul, Kubernetes DNS, Eureka |
| **Circuit Breaker** | Prevent cascade failures | Resilience4j, Polly, Hystrix (legacy) |
| **Sidecar** | Cross-cutting concerns alongside service | Envoy, Linkerd proxy |
| **Strangler Fig** | Incremental migration from monolith | Route traffic gradually to new services |
| **BFF** (Backend for Frontend) | Tailored API per client type | One BFF for web, one for mobile |
| **Saga** | Distributed transactions | Choreography or Orchestration |
| **Outbox** | Reliable event publishing | Write event to DB table, relay asynchronously |

### Circuit Breaker State Machine

```
         success          ┌──────────┐
     ┌──────────────────> │  CLOSED  │ <── Normal operation
     │                    │ (passes) │     Counts failures
     │                    └────┬─────┘
     │                         │ failure threshold exceeded
     │                         v
┌────┴──────┐            ┌──────────┐
│ HALF-OPEN │ <───────── │   OPEN   │
│ (probes)  │  timeout   │ (rejects)│ <── All requests fail fast
└────┬──────┘  expires   └──────────┘
     │
     │ probe fails
     └──────────────────> back to OPEN
```

Configuration: failure threshold (e.g., 5 failures in 60s), timeout (e.g., 30s), probe count (e.g., 3 successes to close).

### When NOT to Use Microservices
- Team < 5 developers
- No CI/CD pipeline maturity
- No container orchestration (Kubernetes)
- No observability (distributed tracing, centralized logging)
- Domain boundaries are unclear
- Startup/MVP stage -- optimize for speed, not architecture

## Event-Driven Architecture

### Three Styles

| Style | Description | Use Case |
|-------|-------------|----------|
| **Event Notification** | Publish event, consumers react | "OrderPlaced" triggers email, inventory |
| **Event-Carried State Transfer** | Event contains full state | Consumer caches state, reduces queries |
| **Event Sourcing** | Store events as source of truth | Audit log, temporal queries, replay |

### Event Sourcing

```
// Instead of storing current state:
Account { balance: 150 }

// Store the sequence of events:
[
  AccountCreated { id: 1, owner: "Alice" },
  MoneyDeposited { amount: 200 },
  MoneyWithdrawn { amount: 50 },
]

// Current state = replay all events
// Can answer: "What was the balance at 2pm yesterday?"
// Can rebuild read models from scratch
```

**Trade-offs:**
- Pro: Full audit trail, temporal queries, rebuild projections
- Con: Eventual consistency, complexity, event schema evolution

## CQRS (Command Query Responsibility Segregation)

Separates read and write models for different optimization.

```
                    ┌─────────────┐
  Commands ────────>│ Write Model │───> Write DB (normalized, ACID)
  (create, update)  │ (Domain)    │       │
                    └─────────────┘       │ events / CDC
                                          v
                    ┌─────────────┐   ┌──────────────┐
  Queries ─────────>│ Read Model  │<──│ Projection   │
  (list, search)    │ (Denorm.)   │   │ (builds view)│
                    └─────────────┘   └──────────────┘
```

| Variant | Description |
|---------|-------------|
| **Simple CQRS** | Separate read/write models, same DB |
| **CQRS + Separate DBs** | Write to PostgreSQL, read from Elasticsearch |
| **CQRS + Event Sourcing** | Events as write store, projections as read store |

**When to use:** Read/write patterns differ significantly (e.g., complex writes, simple reads or vice versa). High read-to-write ratio.

## DDD (Domain-Driven Design) Tactical Patterns

### Building Blocks

| Concept | Definition | Example |
|---------|-----------|---------|
| **Entity** | Has identity, lifecycle | `User(id: UUID)`, `Order(id: UUID)` |
| **Value Object** | Defined by attributes, immutable, no identity | `Money(amount, currency)`, `Address(...)` |
| **Aggregate** | Cluster of entities with a root, consistency boundary | `Order` (root) + `OrderLine` items |
| **Repository** | Collection-like interface for aggregate persistence | `OrderRepository.findById(id)` |
| **Domain Service** | Logic that doesn't belong to any single entity | `PricingService.calculateDiscount(order, customer)` |
| **Domain Event** | Something significant that happened in the domain | `OrderPlaced`, `PaymentReceived` |
| **Factory** | Complex aggregate creation logic | `OrderFactory.createFromCart(cart)` |

### Aggregate Rules
1. Reference other aggregates by ID only (not direct object reference)
2. Changes within an aggregate are atomic (single transaction)
3. Keep aggregates small -- large aggregates cause contention
4. Only the aggregate root is referenced externally

### Bounded Contexts & Context Map

```
┌───────────────────┐     ┌───────────────────┐
│   Order Context   │     │  Shipping Context  │
│                   │     │                    │
│  Order            │     │  Shipment          │
│  OrderLine        │ ACL │  Package           │
│  Customer (id)    │────>│  Address           │
│                   │     │  Carrier           │
└───────────────────┘     └───────────────────┘
```

| Relationship | Description |
|-------------|-------------|
| **Shared Kernel** | Two contexts share a common model (tight coupling) |
| **Customer/Supplier** | Upstream context serves downstream (API contract) |
| **ACL (Anti-Corruption Layer)** | Translates between contexts (prevents model leakage) |
| **Conformist** | Downstream adopts upstream model as-is |
| **Published Language** | Shared interchange format (e.g., standard JSON schema) |

## Caching Strategies

### Access Patterns

| Strategy | How It Works | Best For |
|----------|-------------|----------|
| **Cache-Aside** (Lazy) | App checks cache, on miss reads DB, writes to cache | General purpose, read-heavy |
| **Read-Through** | Cache itself fetches from DB on miss | Simpler app code, cache manages reads |
| **Write-Through** | Write to cache and DB synchronously | Strong consistency, read after write |
| **Write-Behind** (Write-Back) | Write to cache, async write to DB | High write throughput, acceptable lag |

### Cache Levels

```
Request
  |
  v
[L1: In-Process Cache]     HashMap/LRU in app memory (~1ms)
  |  miss
  v
[L2: Distributed Cache]    Redis/Memcached (~2-5ms)
  |  miss
  v
[L3: CDN / Edge Cache]     CloudFront/Fastly (~10-50ms)
  |  miss
  v
[Origin: Database]          PostgreSQL/DynamoDB (~50-200ms)
```

### Cache Invalidation
- **TTL (Time-to-Live):** Simple, eventual consistency. Good default.
- **Event-based:** Invalidate on write events. Stronger consistency.
- **Versioned keys:** `user:42:v3` -- bump version on change. No explicit invalidation.

Rule: "There are only two hard things in CS: cache invalidation and naming things." Start with TTL, add event-based invalidation only when stale data is a real problem.

## Load Balancing

| Algorithm | How It Works | Best For |
|-----------|-------------|----------|
| **Round Robin** | Sequential distribution | Equal-capacity servers |
| **Weighted Round Robin** | Proportional to server capacity | Mixed-capacity servers |
| **Least Connections** | Routes to server with fewest active connections | Variable request duration |
| **IP Hash** | Consistent routing by client IP | Session affinity (sticky sessions) |
| **Random** | Random server selection | Simple, surprisingly effective |

## Message Queue Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| **Point-to-Point** | One producer, one consumer | Task queue (SQS) |
| **Pub/Sub** | One producer, many consumers | Event broadcasting (SNS, Kafka topic) |
| **Dead Letter Queue** | Failed messages go to separate queue | Error handling, retry analysis |
| **Priority Queue** | Messages processed by priority | VIP customer orders first |
| **Competing Consumers** | Multiple consumers on same queue | Horizontal scaling of workers |
