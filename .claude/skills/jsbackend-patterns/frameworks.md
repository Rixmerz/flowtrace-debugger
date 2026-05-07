# JS/TS Backend Frameworks & Libraries

## Web / API Frameworks

| Framework | Version | Runtime Support | Key Trait | When to Use |
|-----------|---------|-----------------|-----------|-------------|
| **Express** | 5.x | Node | Ubiquitous, massive middleware ecosystem | Legacy projects, quick prototypes |
| **Fastify** | 4/5.x | Node | Schema-based validation, 2-3x faster than Express | Default for new Node.js APIs |
| **NestJS** | 10.x | Node, (Deno partial) | Angular-style DI, decorators, opinionated structure | Enterprise, large teams, microservices |
| **Hono** | 4.x | Node, Deno, Bun, CF Workers, Lambda | Ultra-light (~14KB), runs everywhere, middleware | Edge/multi-runtime, lightweight APIs |
| **Elysia** | 1.x | Bun | End-to-end type safety, fastest Bun framework | Bun-native projects, type-first APIs |
| **H3/Nitro** | — | Node, Deno, Bun, CF Workers | UnJS ecosystem, Nuxt server engine | Universal handlers, Nuxt backends |
| **AdonisJS** | 6.x | Node | Laravel-like, batteries-included (auth, mail, ORM) | Full-stack monoliths, rapid development |
| **tRPC** | 11.x | Any | End-to-end type safety, no codegen | Full-stack TS apps with shared types |

### Express vs Fastify Quick Comparison
| Aspect | Express 5.x | Fastify 5.x |
|--------|-------------|-------------|
| Throughput | ~15K req/s | ~40K req/s |
| Validation | Manual (middleware) | Built-in (JSON Schema / Typebox) |
| Logging | Manual | Pino built-in |
| Async errors | Must wrap in try/catch | Auto-catches async handler errors |
| Plugin system | Middleware chain | Encapsulated plugin tree |
| TypeScript | @types/express | Native TS support |

## Persistence / ORM

| Library | Version | Approach | Best For |
|---------|---------|----------|----------|
| **Prisma** | 5/6.x | Schema-first, auto-generated client, migrations | Developer experience, rapid prototyping |
| **Drizzle ORM** | 0.3x | SQL-like API, zero overhead, schema in TS | SQL-close control, performance-critical |
| **TypeORM** | 0.3.x | Decorator-based, ActiveRecord + DataMapper | Legacy projects (not recommended for new) |
| **Kysely** | 0.27.x | Type-safe query builder, no ORM overhead | Query builders, existing schemas |
| **MikroORM** | 6.x | Data Mapper, Unit of Work, identity map | DDD, complex domain models |
| **Mongoose** | 8.x | MongoDB ODM, schema validation | MongoDB projects |

### Drizzle vs Prisma Quick Comparison
| Aspect | Drizzle | Prisma |
|--------|---------|--------|
| Schema | TypeScript files | `.prisma` DSL |
| Query style | SQL-like (`db.select().from()`) | Method chaining (`db.user.findMany()`) |
| Bundle size | ~50KB | ~2MB (engine binary) |
| Relations | Explicit joins | Implicit via `include` |
| Edge support | Yes (all runtimes) | Limited (Prisma Accelerate) |
| Migrations | SQL-based, diffable | Auto-generated, opaque |

## Testing

| Library | Version | Key Trait | When to Use |
|---------|---------|-----------|-------------|
| **Vitest** | 2.x | Fast, ESM-native, TS-native, Jest-compatible API | Default for all new projects |
| **Jest** | 29.x | Most popular, large ecosystem | Legacy projects, React (CRA) |
| **Supertest** | — | HTTP assertion library | API endpoint testing |
| **Testcontainers** | — | Docker-based integration tests | DB/Redis/Kafka integration tests |
| **msw** | 2.x | Network-level mocking (Service Worker / Node interceptor) | API mocking without changing app code |
| **@faker-js/faker** | 9.x | Realistic fake data generation | Test data seeding |

## Validation / Schema

| Library | Size | Key Trait | When to Use |
|---------|------|-----------|-------------|
| **Zod** | ~13KB | Most popular, rich ecosystem, `.parse()` and `.safeParse()` | Default choice |
| **Valibot** | ~1KB (tree-shakeable) | Modular, smallest bundle | Edge/serverless, bundle-sensitive |
| **TypeBox** | ~4KB | JSON Schema compatible, Fastify native | Fastify projects, OpenAPI |
| **Effect/Schema** | — | Part of Effect ecosystem, bidirectional transformations | Effect-based apps |
| **Arktype** | — | Runtime-validated types that look like TS syntax | DX-focused validation |

## Security

| Library | Purpose |
|---------|---------|
| **jose** | JWT sign/verify/encrypt (standards-compliant, no native deps) |
| **passport** | Authentication strategies (OAuth, SAML, local) |
| **helmet** | HTTP security headers for Express/Fastify |
| **@fastify/rate-limit** | Rate limiting (Fastify plugin) |
| **express-rate-limit** | Rate limiting (Express middleware) |
| **bcrypt / argon2** | Password hashing |
| **csurf / csrf-csrf** | CSRF protection |

## Messaging / Queues

| Library | Purpose | When to Use |
|---------|---------|-------------|
| **BullMQ** | Redis-based job queue, scheduling, retries | Default for background jobs |
| **kafkajs** | Apache Kafka client | Event streaming, high-throughput |
| **amqplib** | RabbitMQ client | AMQP messaging, complex routing |
| **@node-redis** (ioredis) | Redis client | Caching, pub/sub, sessions |
| **pg-boss** | PostgreSQL-based job queue | When you don't want Redis |
| **Temporal** | Durable workflow orchestration | Long-running workflows, sagas |

## Observability

| Library | Purpose | When to Use |
|---------|---------|-------------|
| **OpenTelemetry** (@opentelemetry/*) | Traces, metrics, logs (vendor-neutral) | Default for distributed tracing |
| **Pino** | Structured JSON logging, fastest logger | Default for all logging |
| **winston** | Feature-rich logging, transports | Legacy projects |
| **Prometheus client** (prom-client) | Metrics exposition | Prometheus/Grafana stack |
| **Sentry** (@sentry/node) | Error tracking, performance monitoring | Error reporting |

## Build / Dev Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **tsx** | Run TS directly (esbuild-powered, watch mode) | Development, scripts |
| **tsup** | Bundle TS libraries (esbuild + Rollup) | Publishing npm packages |
| **esbuild** | Ultra-fast bundler/transpiler | Custom build pipelines |
| **Biome** | Formatter + linter (Rust-based, replaces ESLint + Prettier) | New projects wanting speed |
| **pkgroll** | Zero-config package bundler | Simple library builds |

## AI / ML

| Library | Purpose |
|---------|---------|
| **Vercel AI SDK** | Streaming AI responses, tool calling, multi-provider |
| **LangChain.js** | LLM chains, agents, RAG pipelines |
| **@anthropic-ai/sdk** | Claude API client |
| **openai** | OpenAI API client |
| **Ollama.js** | Local LLM inference |
