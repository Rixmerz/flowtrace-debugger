---
paths: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Rules

> Always apply these rules when writing or reviewing TypeScript code.

## DO
- Use `strict: true` in tsconfig
- Prefer `satisfies` over `as` for type validation without widening
- Use discriminated unions for state modeling (status field + data per variant)
- Use `as const` for literal arrays that define union types
- Prefer generics over overloads when possible
- Use branded types for domain IDs (`UserId`, `OrderId`) to prevent mixing
- Use `exhaustive checking` with `assertNever` in switch defaults
- Prefer `Result<T, E>` (neverthrow) over throw for expected errors
- Use `using`/`await using` for resource cleanup (TS 5.2+)
- Validate at system boundaries (user input, external APIs) with Zod/Valibot

## DON'T
- Don't use `any` — use `unknown` and narrow
- Don't use `enum` — use `as const` objects or union types
- Don't use `namespace` — use ES modules
- Don't use legacy decorators (`experimentalDecorators`) — use Stage 3 (TS 5.0+)
- Don't create wrapper types for primitives without branded types
- Don't use `!` (non-null assertion) except in tests
- Don't ignore TypeScript errors with `@ts-ignore` — use `@ts-expect-error` if unavoidable
