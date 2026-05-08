---
name: jsbackend-patterns
description: JavaScript/TypeScript backend reference - Node.js 20/22, Deno 2, Bun 1.x, Edge Runtime. Server frameworks, ORMs, queues, observability, and production patterns for 2024-2025. Use when building backend services, selecting server frameworks, or reviewing server-side JS/TS code.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# JS/TS Backend Architecture Reference (2024-2025)

Comprehensive reference for JavaScript/TypeScript backend architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

Note: For TypeScript type system features (generics, conditional types, mapped types, utility types), see the `ts-patterns` skill instead. This skill focuses on backend runtime concerns.

## Quick Navigation

- For framework/library selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (singleton, factory, strategy, repository, Result), see [design-patterns.md](design-patterns.md)
- For architecture patterns (hexagonal, event-driven, CQRS, graceful shutdown), see [architecture.md](architecture.md)
- For best practices (error handling, async, logging, streams, DO/DON'T), see [best-practices.md](best-practices.md)
- For runtime-specific features (Node.js 20/22, Deno 2, Bun 1.x, CF Workers, TC39), see [language-features.md](language-features.md)

## Decision Framework

1. **Default API server**: Performance -> Fastify. Enterprise DI -> NestJS
2. **Lightweight / Edge**: Hono (runs on Node, Deno, Bun, CF Workers, Vercel, Lambda)
3. **Bun-native**: Elysia (type-safe, fastest Bun framework)
4. **Full-stack monolith**: AdonisJS 6 (Laravel-like, batteries-included)
5. **ORM**: SQL-close -> Drizzle. Developer-friendly -> Prisma
6. **Testing**: Always Vitest (fast, ESM-native, TS-native)
7. **Queues / Background jobs**: BullMQ + Redis
8. **Validation**: Zod (most popular) or Valibot (tree-shakeable)

## Runtime Comparison

| Runtime | Version | Strengths | Trade-offs |
|---------|---------|-----------|------------|
| **Node.js 22** (LTS) | 22.x | Largest ecosystem, most stable, universal deployment | Slower cold start than Bun, no built-in TS |
| **Deno 2** | 2.x | Security-first (permissions), native TS, npm compat, JSR | Smaller ecosystem, some npm packages need adapters |
| **Bun 1.x** | 1.2+ | Fastest runtime, all-in-one (bundler, test, install), native TS | Younger ecosystem, some Node APIs not yet implemented |
| **CF Workers** | — | Edge (300+ PoPs), global low latency, D1/KV/R2 | Limited runtime (no Node APIs), max execution time |

## JS/TS Backend in Production

| Company | Stack / Result |
|---------|----------------|
| **Netflix** | Node.js — reduced startup time by 70%, powers API gateway |
| **Uber** | Node.js — highest throughput services, real-time matching |
| **LinkedIn** | Node.js — moved from Rails, 20x fewer servers |
| **PayPal** | Node.js — double requests/sec vs Java, 35% faster response |
| **Microsoft** | Node.js — VSCode server (code-server), Azure Functions runtime |
| **Vercel** | Edge Runtime — Next.js middleware, global edge functions |
| **Discord** | Node.js + Fastify — API gateway serving 200M+ monthly users |
| **Shopify** | Deno — Remix/Hydrogen storefront engine |

## Supporting Files

| File | Content |
|------|---------|
| `frameworks.md` | Framework comparison tables by domain |
| `design-patterns.md` | Patterns with TypeScript implementations |
| `architecture.md` | Hexagonal, Event-Driven, CQRS, Clean Architecture |
| `best-practices.md` | Error handling, async, logging, production readiness |
| `language-features.md` | Runtime-specific APIs, TC39 proposals, feature comparison |

## Related Skills
- [ts-patterns](../ts-patterns/SKILL.md) — TypeScript type system and tooling
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
