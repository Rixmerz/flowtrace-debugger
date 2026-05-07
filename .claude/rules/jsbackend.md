---
paths: ["**/server/**/*.ts", "**/api/**/*.ts", "**/services/**/*.ts", "**/src/**/*.ts", "**/*.mts"]
---

# JS/TS Backend Rules

> Always apply these rules when writing or reviewing Node.js/backend TypeScript code.

## DO
- Use `Promise.all()` for independent parallel async operations
- Use `Promise.allSettled()` when individual failures are tolerable
- Use structured logging (Pino) with child loggers and context objects
- Use Zod/Valibot for runtime validation at API boundaries
- Use `using`/`await using` (explicit resource management) for resource cleanup when available
- Use graceful shutdown handlers for SIGTERM/SIGINT
- Use ESM (`"type": "module"`) in new projects
- Use `node:` prefix for Node.js built-in imports (`node:fs`, `node:path`, `node:crypto`)
- Use streams (`pipeline` from `node:stream/promises`) for large file processing
- Use connection pooling for database connections
- Use `unknown` instead of `any` for untyped data
- Use Result pattern or typed error unions instead of generic throws
- Use environment variables via validated config (Zod schema, not raw `process.env`)
- Close resources in reverse order during shutdown (LIFO)
- Use `import.meta.url` or `import.meta.dirname` (Node 21.2+) for path resolution in ESM
- Use branded types or newtypes for entity IDs (`UserId`, `OrderId`)

## DON'T
- Don't use `any` -- use `unknown` and narrow with type guards
- Don't leave floating promises (no `await`, no `.catch()`, no `void` prefix)
- Don't use `new Promise()` to wrap functions that already return promises
- Don't use sequential `await` when operations are independent -- use `Promise.all()`
- Don't catch errors silently (empty catch blocks) -- always log or propagate
- Don't throw strings -- throw `Error` instances or typed error objects
- Don't use `console.log` in production -- use a structured logger (Pino)
- Don't read large files entirely into memory -- use streams (`pipeline`)
- Don't store secrets in code -- use environment variables with validated config
- Don't use `__dirname`/`__filename` in ESM -- use `import.meta.url`
- Don't mix CJS `require()` and ESM `import` in the same module
- Don't use callback-based APIs when promise versions exist (`fs.promises`, `stream/promises`)
- Don't use `eval()` or `new Function()` with user input -- code injection risk
- Don't mutate shared module-level state without synchronization -- use proper patterns
