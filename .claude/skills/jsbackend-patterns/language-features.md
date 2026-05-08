# JS/TS Backend Runtime Features

Note: For TypeScript type system features (generics, conditional types, mapped types, template literals), see the `ts-patterns` skill. This file covers runtime-specific APIs and capabilities.

## Node.js 20 (LTS — Active until Apr 2026)

| Feature | Details |
|---------|---------|
| **Permission model** | `--experimental-permission`, `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process` |
| **Native test runner** | `node --test`, `describe/it/test`, `--test-reporter`, built-in mocking |
| **Single Executable Apps (SEA)** | Bundle Node.js + app into one binary for distribution |
| **Native .env** | `node --env-file=.env app.js` — no dotenv needed |
| **Stable fetch/WebStreams** | `fetch()`, `Response`, `Request`, `ReadableStream` globally available |
| **Import attributes** | `import data from "./data.json" with { type: "json" }` |
| **V8 11.3** | Array grouping, `Promise.withResolvers()`, `ArrayBuffer.transfer()` |

```typescript
// Native test runner (no Vitest/Jest needed for simple cases)
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

describe("UserService", () => {
  it("should find user by email", async () => {
    const mockRepo = mock.fn(async () => ({ id: "1", email: "test@example.com" }));
    const user = await mockRepo("test@example.com");
    assert.equal(user.email, "test@example.com");
    assert.equal(mockRepo.mock.calls.length, 1);
  });
});
```

## Node.js 22 (LTS — Active until Apr 2027)

| Feature | Details |
|---------|---------|
| **WebSocket client** | `new WebSocket("ws://...")` — built-in, no `ws` package needed for client |
| **require(esm)** | `require()` can load ESM modules synchronously (without top-level await) |
| **Native TS (experimental)** | `--experimental-strip-types` — runs `.ts` files directly (type erasure only) |
| **glob native** | `fs.glob("**/*.ts")` / `fs.globSync()` — no glob package needed |
| **SQLite experimental** | `node:sqlite` built-in module |
| **Watch mode stable** | `node --watch app.ts` — auto-restart on file changes |
| **V8 12.4** | `Set` methods (union, intersection, difference), `Iterator.from()` |

```typescript
// Native TS execution (Node 22.6+)
// node --experimental-strip-types server.ts
// Limitations: no enums, no namespaces, no const enum, no parameter properties

// Native glob
import { glob } from "node:fs/promises";
for await (const file of glob("src/**/*.ts")) {
  console.log(file);
}

// Native SQLite
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
insert.run("Alice");
```

## Deno 2 (Stable)

| Feature | Details |
|---------|---------|
| **Granular permissions** | `--allow-read=/data`, `--allow-net=api.example.com`, `--allow-env=DATABASE_URL` |
| **npm compatibility** | `import express from "npm:express"` or use `node_modules/` with `nodeModulesDir: auto` |
| **JSR registry** | `jsr:@std/path`, `jsr:@oak/oak` — TypeScript-first package registry |
| **Deno.serve()** | Built-in HTTP server, ~2.5x faster than `http.createServer` |
| **KV native** | `Deno.openKv()` — built-in key-value store (SQLite locally, Deno Deploy globally) |
| **deno.json** | Config: tasks, imports (import maps), fmt, lint, compilerOptions — all in one file |
| **deno compile** | Compile to standalone binary (cross-compile supported) |
| **Built-in tooling** | `deno fmt`, `deno lint`, `deno test`, `deno bench`, `deno doc` |

```typescript
// deno.json
{
  "imports": {
    "@std/http": "jsr:@std/http@1",
    "@hono/hono": "jsr:@hono/hono@4",
    "drizzle-orm": "npm:drizzle-orm@0.38"
  },
  "tasks": {
    "dev": "deno run --watch --allow-net --allow-read --allow-env main.ts",
    "test": "deno test --allow-net"
  }
}

// Deno.serve — built-in HTTP
Deno.serve({ port: 3000 }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/api/health") {
    return Response.json({ status: "ok" });
  }
  return new Response("Not Found", { status: 404 });
});

// Deno KV
const kv = await Deno.openKv();
await kv.set(["users", "123"], { name: "Alice", email: "alice@example.com" });
const user = await kv.get(["users", "123"]);
// Atomic operations
await kv.atomic()
  .check({ key: ["users", "123"], versionstamp: user.versionstamp })
  .set(["users", "123"], { ...user.value, name: "Alice Updated" })
  .commit();
```

## Bun 1.x (1.2+)

| Feature | Details |
|---------|---------|
| **Bun.serve()** | HTTP server, ~3-4x faster than Node.js `http.createServer` |
| **Native SQLite** | `bun:sqlite` — synchronous, ~10x faster than better-sqlite3 |
| **Bun.file()** | Lazy file I/O, streaming, MIME detection |
| **Hot reload** | `bun --hot` — preserves state, no process restart |
| **bun:test** | Jest-compatible, ~30x faster than Jest |
| **Package manager** | `bun install` — ~25x faster than npm, hardlinks |
| **Bundler** | `bun build` — built-in, esbuild-compatible |
| **Macros** | `import { foo } from "./bar" with { type: "macro" }` — compile-time code execution |
| **Node.js compat** | Most Node.js APIs supported, `node:` prefix works |

```typescript
// Bun.serve — HTTP server
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/users") {
      const users = db.query("SELECT * FROM users").all();
      return Response.json(users);
    }
    return new Response("Not Found", { status: 404 });
  },
  error(err) {
    return new Response(`Error: ${err.message}`, { status: 500 });
  },
});

// bun:sqlite — synchronous, zero-overhead
import { Database } from "bun:sqlite";
const db = new Database("app.db");
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");

const insert = db.prepare("INSERT INTO users (name, email) VALUES ($name, $email)");
insert.run({ $name: "Alice", $email: "alice@example.com" });

const users = db.query("SELECT * FROM users WHERE name LIKE $pattern").all({ $pattern: "%Ali%" });

// Bun.file — lazy file I/O
const file = Bun.file("./data.json");
console.log(file.size);  // No read yet
console.log(file.type);  // "application/json"
const data = await file.json(); // Read + parse
await Bun.write("./output.txt", "Hello"); // Write
```

## Cloudflare Workers

| Feature | Details |
|---------|---------|
| **D1** | SQLite at the edge, SQL API |
| **KV** | Global key-value store, eventually consistent |
| **R2** | S3-compatible object storage, zero egress fees |
| **Durable Objects** | Strongly consistent state + WebSockets per instance |
| **Queues** | Message queues between Workers |
| **Vectorize** | Vector database for AI/embeddings |
| **AI** | Run AI models at the edge (LLMs, embeddings, image gen) |
| **Cron Triggers** | Scheduled execution |

```typescript
// Worker with D1 + Hono
import { Hono } from "hono";

type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/users/:id", async (c) => {
  const id = c.req.param("id");

  // Check KV cache first
  const cached = await c.env.CACHE.get(`user:${id}`);
  if (cached) return c.json(JSON.parse(cached));

  // Query D1
  const user = await c.env.DB
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first();

  if (!user) return c.json({ error: "Not found" }, 404);

  // Cache for 5 minutes
  await c.env.CACHE.put(`user:${id}`, JSON.stringify(user), { expirationTtl: 300 });
  return c.json(user);
});

export default app;
```

## TC39 Features (2024-2025)

### `using` — Explicit Resource Management (Stage 3, TS 5.2+)
```typescript
// Synchronous cleanup
class TempFile implements Disposable {
  constructor(public path: string) { /* create temp file */ }

  [Symbol.dispose](): void {
    fs.unlinkSync(this.path);
  }
}

{
  using tmp = new TempFile("/tmp/data.csv");
  // ... use tmp.path ...
} // Automatically deleted here, even if error thrown

// Async cleanup
class DatabaseTransaction implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {
    await this.rollback(); // Auto-rollback if not committed
  }
}

{
  await using tx = await db.beginTransaction();
  await tx.execute("INSERT INTO orders ...");
  await tx.commit();
} // Auto-rollback if commit not reached
```

### Object.groupBy / Map.groupBy (ES2024)
```typescript
const users = [
  { name: "Alice", role: "admin" },
  { name: "Bob", role: "user" },
  { name: "Charlie", role: "admin" },
];

const byRole = Object.groupBy(users, (u) => u.role);
// { admin: [Alice, Charlie], user: [Bob] }

// Map.groupBy for non-string keys
const byAge = Map.groupBy(users, (u) => u.age >= 18 ? "adult" : "minor");
```

### Decorators (Stage 3, TS 5.0+)
```typescript
function log(target: Function, context: ClassMethodDecoratorContext) {
  return function (...args: unknown[]) {
    console.log(`Calling ${String(context.name)} with`, args);
    return target.apply(this, args);
  };
}

class Service {
  @log
  process(data: string) { return data.toUpperCase(); }
}
```

### Import Attributes (Stage 3)
```typescript
import config from "./config.json" with { type: "json" };
import styles from "./styles.css" with { type: "css" };
```

### Promise.withResolvers() (ES2024)
```typescript
// Before: awkward let declarations
let resolve!: (value: T) => void;
let reject!: (reason: unknown) => void;
const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

// After: clean
const { promise, resolve, reject } = Promise.withResolvers<T>();
```

## Runtime Feature Comparison

| Feature | Node.js 22 | Deno 2 | Bun 1.x | CF Workers |
|---------|-----------|--------|---------|------------|
| Native TypeScript | Experimental (strip) | Full | Full | Via Wrangler |
| Permission model | Experimental | Stable (granular) | No | Sandboxed |
| Package manager | npm/pnpm/yarn | Built-in + npm | Built-in (fastest) | npm via Wrangler |
| Test runner | Built-in | Built-in | Built-in (fastest) | Vitest |
| HTTP server | `http.createServer` | `Deno.serve()` | `Bun.serve()` | `fetch()` handler |
| SQLite | Experimental | Via npm | Built-in (fastest) | D1 |
| WebSocket server | `ws` package | Built-in | Built-in | Durable Objects |
| Watch mode | `--watch` | `--watch` | `--hot` (stateful) | `wrangler dev` |
| Compile to binary | SEA (experimental) | `deno compile` | `bun build --compile` | N/A |
| Top-level await | Yes | Yes | Yes | Yes |
| `node:` imports | Yes | Yes | Yes | Partial |
| Web APIs (fetch, etc.) | Yes | Yes | Yes | Yes |
| Startup time | ~40ms | ~30ms | ~7ms | <1ms (edge) |
