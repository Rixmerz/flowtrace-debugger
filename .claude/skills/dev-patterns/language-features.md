# System Design Concepts

Since `dev-patterns` is language-agnostic, this file covers system design fundamentals rather than language features.

## CAP Theorem

In a distributed system, you can only guarantee two of three properties simultaneously:

```
        Consistency
           /\
          /  \
         /    \
        / CP   \
       /   AP   \
      /          \
     /____________\
Availability    Partition
                Tolerance
```

| Property | Definition |
|----------|-----------|
| **Consistency** | Every read returns the most recent write |
| **Availability** | Every request gets a response (not error) |
| **Partition Tolerance** | System works despite network partitions |

Since network partitions are inevitable in distributed systems, the real choice is **CP vs AP**:

| Type | Behavior During Partition | Examples |
|------|--------------------------|----------|
| **CP** | Rejects requests to maintain consistency | ZooKeeper, etcd, HBase, MongoDB (default) |
| **AP** | Serves requests but may return stale data | Cassandra, DynamoDB, CouchDB, DNS |

### PACELC Extension
When there is **no partition** (normal operation), there is still a trade-off:

```
If Partition:
  Choose Availability or Consistency (CAP)
Else (normal operation):
  Choose Latency or Consistency (PACELC)
```

| System | Partition | Normal |
|--------|-----------|--------|
| **DynamoDB** | AP | EL (eventual, low latency) |
| **Cassandra** | AP | EL (tunable consistency) |
| **MongoDB** | CP | EC (consistent, higher latency) |
| **PostgreSQL** | CP | EC (strong consistency) |

## SQL vs NoSQL

| Criterion | SQL (PostgreSQL, MySQL) | NoSQL (MongoDB, DynamoDB, Cassandra) |
|-----------|------------------------|--------------------------------------|
| **Data model** | Tables, rows, columns | Documents, key-value, wide-column, graph |
| **Schema** | Rigid, enforced | Flexible, schema-on-read |
| **Relations** | JOINs, foreign keys | Denormalized, embedded documents |
| **ACID** | Full support | Varies (DynamoDB: per-item, MongoDB: per-doc) |
| **Horizontal scaling** | Hard (read replicas, sharding complex) | Native (designed for distribution) |
| **Ad-hoc queries** | Excellent (SQL is powerful) | Limited (often requires indexes or scans) |
| **Best for** | Complex queries, transactions, reporting | High throughput, flexible schema, massive scale |

**Default choice:** Start with PostgreSQL. It handles JSON (JSONB), full-text search, geospatial, time-series, and scales vertically to millions of rows. Move to NoSQL when you have a specific scaling or schema problem PostgreSQL cannot solve.

## Synchronous vs Asynchronous Communication

| Aspect | Synchronous (REST, gRPC) | Asynchronous (Kafka, SQS, RabbitMQ) |
|--------|--------------------------|--------------------------------------|
| **Coupling** | Temporal (caller waits) | Decoupled (fire-and-forget) |
| **Latency** | Immediate response | Eventually processed |
| **Failure** | Cascading (downstream down = caller fails) | Isolated (message queued, retried) |
| **Debugging** | Simple (request/response trace) | Complex (distributed, eventual) |
| **Ordering** | Guaranteed per request | Depends on broker (Kafka: per partition) |
| **Best for** | User-facing APIs, queries, real-time | Background jobs, events, inter-service |

Rule: Synchronous for queries and user-facing reads. Asynchronous for commands that can be eventually processed.

## Monolith vs Modular Monolith vs Microservices

| Aspect | Monolith | Modular Monolith | Microservices |
|--------|----------|-------------------|---------------|
| **Deployment** | Single unit | Single unit | Independent per service |
| **Database** | Shared | Shared (logical separation) | Per service |
| **Communication** | In-process calls | In-process (module APIs) | Network (HTTP, gRPC, events) |
| **Team size** | 1-10 | 5-20 | 15+ |
| **Complexity** | Low | Medium | High |
| **Scaling** | All-or-nothing | All-or-nothing | Per service |
| **Testing** | Simple | Simple | Complex (contract tests) |
| **Operational cost** | Low | Low | High (K8s, service mesh, tracing) |

## Polyglot Persistence

Use the right database for each data type:

```
┌──────────────────────────────────────────────┐
│                 Application                   │
└──────┬──────┬──────┬──────┬──────┬───────────┘
       │      │      │      │      │
       v      v      v      v      v
  ┌────────┐ ┌─────┐ ┌───────────┐ ┌────┐ ┌─────────────┐
  │Postgres│ │Redis│ │Elasticsearch│ │ S3 │ │ ClickHouse  │
  │(OLTP)  │ │(cache│ │ (search)   │ │(obj)│ │ (analytics) │
  └────────┘ │ sesh)│ └───────────┘ └────┘ └─────────────┘
             └─────┘
```

| Data Type | Store | Why |
|-----------|-------|-----|
| Transactional (orders, users) | PostgreSQL | ACID, relations, ad-hoc queries |
| Session, cache, rate limits | Redis | Sub-ms latency, TTL, data structures |
| Full-text search, logs | Elasticsearch / OpenSearch | Inverted index, faceted search |
| Files, images, backups | S3 / Cloud Storage | Cheap, durable, scalable |
| Analytics, time-series | ClickHouse / TimescaleDB | Columnar, fast aggregations |
| Graph relationships | Neo4j / Neptune | Traverse relationships efficiently |

## Technology Evaluation Framework

Based on ThoughtWorks Technology Radar:

| Ring | Meaning | Action |
|------|---------|--------|
| **ADOPT** | Proven, industry default | Use confidently in production |
| **TRIAL** | Worth pursuing, proven in some orgs | Use in non-critical projects, evaluate |
| **ASSESS** | Interesting, worth exploring | Research, POC, no production commitment |
| **HOLD** | Use with caution or avoid | Don't start new projects with this |

### Evaluation Criteria
1. **Team expertise:** Can the team learn and maintain it?
2. **Community & ecosystem:** Active development? Good docs? Libraries?
3. **Operational maturity:** Monitoring, debugging, deployment tooling?
4. **Lock-in risk:** Can you migrate away if needed?
5. **Total cost of ownership:** Not just license -- training, ops, hiring

## AI/LLM Architecture Patterns

### RAG (Retrieval-Augmented Generation)
```
User query
  |
  v
[1. Embed query]        Convert to vector
  |
  v
[2. Vector search]      Find relevant docs (Pinecone, pgvector, Qdrant)
  |
  v
[3. Context assembly]   Combine retrieved docs + query
  |
  v
[4. LLM generation]     Generate answer grounded in retrieved context
  |
  v
Response with citations
```

### Agentic Loops
```
User goal
  |
  v
[Plan]          LLM decides which tools/steps are needed
  |
  v
[Execute]       Call tools (search, code, API, DB)
  |
  v
[Observe]       Evaluate results
  |
  v
[Decide]        Continue, retry, or complete
  |
  └──> back to [Plan] if not done
```

### AI System Considerations
- **Latency:** LLM calls are 500ms-30s. Design UX for streaming, async processing
- **Costs:** Token-based pricing. Cache common queries, use smaller models for classification
- **Evals:** Automated evaluation suites (not just vibes). Test accuracy, relevance, safety
- **Observability:** Log prompts, responses, latency, token usage, error rates
- **Guardrails:** Input filtering, output validation, rate limiting, content safety
- **Determinism:** LLMs are non-deterministic. Use temperature=0 for consistency, seed for reproducibility

## Current Trends (2024-2025)

| Trend | What | Status |
|-------|------|--------|
| **AI-Augmented Dev** | Copilot, Claude Code, Cursor, AI code review | ADOPT |
| **Platform Engineering** | Internal Developer Platforms (IDP), Backstage | TRIAL |
| **eBPF** | Kernel-level observability without agents (Cilium, Falco) | TRIAL |
| **WASM beyond browser** | Server-side WASM (Spin, wasmCloud), edge compute | ASSESS |
| **Service Mesh** | Istio, Linkerd for mTLS, observability, traffic management | TRIAL |
| **Durable Execution** | Temporal, Conductor for reliable distributed workflows | TRIAL |
| **Edge Computing** | Cloudflare Workers, Deno Deploy, Vercel Edge | ADOPT (for appropriate workloads) |
| **OpenTelemetry** | Vendor-neutral observability standard | ADOPT |
| **GitOps** | ArgoCD, Flux for declarative K8s management | ADOPT |
| **Zero Trust** | Never trust, always verify (mTLS, identity-aware proxy) | TRIAL |
| **Serverless Containers** | AWS Fargate, Cloud Run, Azure Container Apps | ADOPT |
| **Vector Databases** | Pinecone, Qdrant, pgvector, Weaviate for AI/RAG | TRIAL |
