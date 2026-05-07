---
name: ts-patterns
description: TypeScript architecture reference - frameworks, design patterns, type system, and build tooling for 2024-2025. Use when making architectural decisions, reviewing TypeScript code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|types|build|all]"
---

# TypeScript Architecture Reference (2024-2025)

Comprehensive reference for TypeScript architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (creational, structural, behavioral, modern), see [design-patterns.md](design-patterns.md)
- For type system mastery (generics, conditional types, mapped types), see [type-system.md](type-system.md)
- For architecture patterns (Clean, Hexagonal, Vertical Slice, DDD), see [architecture.md](architecture.md)

## Decision Framework

When asked to choose between options, evaluate:

1. **Team size**: Solo/small -> lightweight (Hono, Drizzle, Zustand). Large -> opinionated (NestJS, Prisma, Redux Toolkit)
2. **Deploy target**: Edge/serverless -> small bundles (Hono, Valibot, Drizzle). Traditional server -> any
3. **Type safety priority**: Maximum -> tRPC + Zod + Drizzle. Pragmatic -> Express + Prisma
4. **Ecosystem maturity**: Established -> Express, Prisma, Jest. Modern -> Fastify, Drizzle, Vitest
5. **Monorepo**: Yes -> Nx or Turborepo + tRPC. No -> simpler setup

## TypeScript Evolution

| Version | Key Feature |
|---------|------------|
| 5.4 | `NoInfer<T>`, closure narrowing |
| 5.5 | Inferred type predicates, `isolatedDeclarations` |
| 5.6 | Always-truthy checks, Iterator Helpers types |
| 5.7 | Uninitialized variable checks, `--rewriteRelativeImportExtensions` |
| 5.8 | `--erasableSyntaxOnly` for Node.js type stripping |
| 5.9 | `import defer`, expandable hovers, type cache |
| 6.0 | `--strict` default, ESM default, last JS-based release |
| 7.0 | **Go rewrite (Project Corsa)**: 10x speed, half memory |

## tsconfig Recommendations

### Strict project (2025)
```json
{
  "compilerOptions": {
    "target": "es2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["es2022"], "strict": true, "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true, "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true, "isolatedModules": true,
    "verbatimModuleSyntax": true, "skipLibCheck": true
  }
}
```

### Bundler project (Vite/esbuild)
```json
{ "compilerOptions": { "module": "Preserve", "moduleResolution": "bundler", "noEmit": true } }
```

### Node.js type stripping (25.2+)
```json
{
  "compilerOptions": {
    "noEmit": true, "target": "esnext", "module": "nodenext",
    "rewriteRelativeImportExtensions": true, "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true
  }
}
```

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [ui-patterns](../ui-patterns/SKILL.md) — Frontend architecture and component patterns
- [jsbackend-patterns](../jsbackend-patterns/SKILL.md) — Node.js/Deno/Bun backend runtime concerns
