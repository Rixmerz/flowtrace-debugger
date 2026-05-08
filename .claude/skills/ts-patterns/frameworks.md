# TypeScript Frameworks Reference

## Web/API Server-side

| Framework | Downloads/Stars | Key Trait | When to Use |
|-----------|----------------|-----------|-------------|
| **Express** | 43M+/wk | v5.0 (Sep 2024), requires @types/express | Ecosystem compat, hiring ease |
| **Fastify** | ~2x Express perf | Plugin arch, JSON Schema validation, OpenAPI gen | Production APIs where perf matters |
| **Hono** | ~14KB | Web Standards, Node/Deno/Bun/Edge/Lambda | Edge/serverless, multi-runtime |
| **Elysia** | Bun-native | TypeBox type safety, extreme benchmarks | Teams fully committed to Bun |
| **NestJS** | Enterprise | DI, decorators, modules, Express/Fastify internal | Large teams, microservices |
| **tRPC** | End-to-end typesafe | No codegen, types inferred backend->frontend | Monorepos, shared TS frontend+backend |
| **AdonisJS** | Laravel/Rails | ORM, auth, validation, mailer included | Full-stack monoliths |
| **Encore.ts** | Rust runtime | 9x Express, 2-3x Elysia/Hono | High-perf APIs with auto validation |

## Frontend

| Framework | Adoption | Key Trait | When to Use |
|-----------|----------|-----------|-------------|
| **React** | 82% | React 19, Server Components, massive ecosystem | Default choice |
| **Vue 3** | — | Composition API, excellent TS inference | Superior DX, smooth learning |
| **Angular** | — | TS mandatory, DI, Signals v17+ | Enterprise with strict arch |
| **Svelte 5** | — | Compiler, runes, minimal bundles | Performance + elegant DX |
| **Solid.js** | — | JSX without VDOM, native signals | High-perf interactive UIs |
| **Qwik** | — | Resumability, zero hydration | E-commerce at massive scale |
| **Astro** | — | Content-first, zero JS default, Islands | Blogs, docs, content sites |

## Meta-frameworks

- **Next.js 14/15**: 135K stars, 52.9% adoption. App Router, RSC, Server Actions, Turbopack
- **Remix** (React Router v7): Progressive enhancement, loaders/actions. Shopify Hydrogen
- **Nuxt 3**: Vue meta-framework. **SvelteKit** for Svelte. **Analog** for Angular
- **T3 Stack**: Next.js + tRPC + Prisma + Tailwind + NextAuth (startup standard)

## ORM & Database

| Tool | Approach | Bundle | Best For |
|------|----------|--------|----------|
| **Prisma** | Schema-first, auto-generated client | ~6.5MB | Established projects, broad DB support |
| **Drizzle** | SQL-first, code-first, TS pure | ~7.4KB | Serverless/edge (10x cold starts vs Prisma) |
| **Kysely** | Type-safe SQL query builder | — | Full SQL control with type safety |
| **MikroORM** | Data Mapper, Unit of Work | — | DDD projects |

## Validation

| Library | Size | Speed | Best For |
|---------|------|-------|----------|
| **Zod** | ~12KB | Standard | 78+ integrations (tRPC, RHF, Next.js). v4 coming |
| **Valibot** | ~1KB | — | Bundle-sensitive (client, edge). Tree-shakeable |
| **ArkType** | 0 deps | 2-4x Zod | Performance-critical validation |
| **TypeBox** | — | Ultra (Ajv) | Fastify/Elysia, JSON Schema compat |

## Testing

- **Vitest**: Recommended for new projects. Vite-powered, Jest-compatible API, native TS/ESM
- **Playwright**: E2E standard (Microsoft), native TS support
- **MSW**: Network-level request mocking without changing app code

## State Management

- Server state: **TanStack Query** (fetching, caching, sync)
- Client state: **Zustand** (41% adoption, ~1KB) or **Jotai** (atomic)
- Enterprise: **Redux Toolkit**. Vue: **Pinia**

## Build Tools

- **Vite**: Dominant dev/build. esbuild dev, Rollup->Rolldown prod
- **tsup**: Zero-config library bundler (ESM + CJS + .d.ts)
- **esbuild/SWC**: 10-100x faster transpilers
- **Turbopack**: Rust, stable in Next.js dev
- **Rspack**: Drop-in webpack replacement (Rust)
- **Biome**: Prettier+ESLint replacement (Rust)
- **Oxc**: Toolchain with parser, linter, transformer (Rust)

## Monorepo

- **Turborepo**: Simplest config, smart task caching, `--affected`
- **Nx**: Most complete, dep graph, distributed execution, code generators

## DI

- **NestJS**: Decorator-based `@Injectable()`, most used
- **tsyringe** (Microsoft): Lightweight with decorators
- **Awilix**: No decorators needed
- **Effect-TS**: DI via `Context.Tag` + `Layer`, fully in type system

## Logging & Caching

- **Pino**: 5-10x faster than Winston, JSON structured, Fastify default
- **Winston**: Most versatile, multiple transports
- **ioredis**: Redis standard for Node.js
- **unstorage** (UnJS): Universal caching with 20+ drivers
