# JS/TS Backend Best Practices (2024-2025)

## Error Handling

### AppError Base Class
```typescript
class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, 404, "NOT_FOUND");
  }
}

class ValidationError extends AppError {
  constructor(public readonly errors: Array<{ field: string; message: string }>) {
    super("Validation failed", 400, "VALIDATION_ERROR");
  }
}

class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}
```

### Global Error Handler (Fastify)
```typescript
app.setErrorHandler((error, request, reply) => {
  // Operational errors — expected, send structured response
  if (error instanceof AppError && error.isOperational) {
    request.log.warn({ err: error, code: error.code }, error.message);
    return reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
      ...(error instanceof ValidationError && { details: error.errors }),
    });
  }

  // Zod validation errors
  if (error.name === "ZodError") {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: "Invalid request",
      details: error.issues,
    });
  }

  // Programming errors — log full stack, send generic response
  request.log.error({ err: error }, "Unhandled error");
  return reply.status(500).send({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
  });
});
```

### Global Error Handler (Express)
```typescript
// Must have 4 params for Express to recognize as error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError && err.isOperational) {
    logger.warn({ err, code: err.code }, err.message);
    return res.status(err.statusCode).json({ error: err.code, message: err.message });
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" });
});
```

## TypeScript Strict Config
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```
- `noUncheckedIndexedAccess`: Array/object index returns `T | undefined`, prevents unsafe access
- `exactOptionalPropertyTypes`: `{ x?: string }` does NOT accept `undefined` as explicit value
- `verbatimModuleSyntax`: Forces `import type` for type-only imports (tree-shaking, correctness)

## Async Patterns

### Parallel: `Promise.all` for independent operations
```typescript
// GOOD: runs in parallel (~200ms total if each takes ~200ms)
const [user, orders, preferences] = await Promise.all([
  userRepo.findById(id),
  orderRepo.findByUserId(id),
  prefService.getForUser(id),
]);

// BAD: sequential (~600ms total)
const user = await userRepo.findById(id);
const orders = await orderRepo.findByUserId(id);
const preferences = await prefService.getForUser(id);
```

### Tolerant: `Promise.allSettled` when individual failures are OK
```typescript
const results = await Promise.allSettled([
  sendEmail(user.email),
  sendSMS(user.phone),
  sendPushNotification(user.deviceId),
]);

const failures = results
  .filter((r): r is PromiseRejectedResult => r.status === "rejected")
  .map((r) => r.reason);

if (failures.length > 0) {
  logger.warn({ failures }, "Some notifications failed");
}
```

### Never leave floating promises
```typescript
// BAD: floating promise — unhandled rejection will crash Node 22+
someAsyncOperation();

// GOOD: explicitly handle
await someAsyncOperation();
// or
void someAsyncOperation().catch((err) => logger.error({ err }, "Background task failed"));
```

## Logging with Pino

### Structured logging setup
```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Redact sensitive fields
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Pretty print only in dev
  ...(process.env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
});
```

### Child loggers with context
```typescript
// Create per-request logger with request ID
app.addHook("onRequest", (req, reply, done) => {
  req.log = logger.child({
    requestId: req.id,
    method: req.method,
    url: req.url,
  });
  done();
});

// In service layer
class OrderService {
  private log: pino.Logger;

  constructor(parentLogger: pino.Logger) {
    this.log = parentLogger.child({ service: "OrderService" });
  }

  async createOrder(dto: CreateOrderDTO): Promise<Order> {
    this.log.info({ customerId: dto.customerId }, "Creating order");
    // ...
    this.log.info({ orderId: order.id, total: order.total }, "Order created");
    return order;
  }
}
```

### Never string concatenation
```typescript
// BAD: allocates string even if log level filters it out
logger.info("User " + userId + " created order " + orderId);

// GOOD: structured, searchable, zero allocation if filtered
logger.info({ userId, orderId }, "Order created");
```

## Graceful Shutdown Checklist
1. Catch SIGTERM and SIGINT
2. Stop accepting new connections (server.close())
3. Finish in-flight requests (drain timeout ~10s)
4. Close consumers (Kafka, BullMQ workers)
5. Flush producers (Kafka, queues)
6. Close database pools
7. Close Redis connections
8. Exit with code 0

Close resources in **reverse order** of creation.

## ESM Over CJS
```json
// package.json
{
  "type": "module"
}
```

- Use `import/export`, not `require/module.exports`
- Use `import.meta.url` instead of `__dirname`/`__filename`
- Use `node:` prefix for built-ins: `import { readFile } from "node:fs/promises"`
- Use `import.meta.dirname` (Node 21.2+) as direct `__dirname` replacement

## Streams for Large Data
```typescript
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { Transform } from "node:stream";

// Process large CSV without loading into memory
await pipeline(
  createReadStream("/data/large-file.csv"),
  new Transform({
    transform(chunk, encoding, callback) {
      // Process chunk
      callback(null, processChunk(chunk));
    },
  }),
  createGzip(),
  createWriteStream("/data/output.csv.gz")
);
```

Never `fs.readFileSync()` or `fs.readFile()` for files > 50MB. Use streams.

## Validation at Boundaries
```typescript
import { z } from "zod";

// Define schema once, derive type
const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(13).max(150).optional(),
  role: z.enum(["user", "admin"]).default("user"),
});

type CreateUserDTO = z.infer<typeof CreateUserSchema>;

// Validate at route handler (boundary), pass typed data to services
app.post("/users", async (req, reply) => {
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    return reply.status(400).send({ errors: result.error.flatten().fieldErrors });
  }
  // result.data is fully typed CreateUserDTO
  const user = await userService.create(result.data);
  return reply.status(201).send(user);
});
```

## Branded Types for Entity IDs
```typescript
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

function UserId(id: string): UserId { return id as UserId; }
function OrderId(id: string): OrderId { return id as OrderId; }

// Now these are distinct types:
function getOrder(orderId: OrderId): Promise<Order> { /* ... */ }

getOrder(UserId("123")); // Type error!
getOrder(OrderId("123")); // OK
```

## Environment Configuration
```typescript
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

// Validate once at startup — fail fast
export const env = EnvSchema.parse(process.env);

// Never use raw process.env elsewhere
// BAD: process.env.DATABASE_URL (string | undefined, no validation)
// GOOD: env.DATABASE_URL (string, validated)
```

## Connection Pooling
```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,                    // Max connections in pool
  idleTimeoutMillis: 30_000,  // Close idle connections after 30s
  connectionTimeoutMillis: 5_000, // Fail fast if can't connect in 5s
});

// Monitor pool health
pool.on("error", (err) => {
  logger.error({ err }, "Unexpected pool error");
});

// Health check endpoint
app.get("/health", async (req, reply) => {
  try {
    await pool.query("SELECT 1");
    return reply.send({ status: "ok", pool: { total: pool.totalCount, idle: pool.idleCount } });
  } catch {
    return reply.status(503).send({ status: "unhealthy" });
  }
});
```

## Testing Patterns
```typescript
import { describe, it, expect, beforeEach } from "vitest";

// Use in-memory adapters, not mocks
describe("OrderService", () => {
  let orderRepo: InMemoryOrderRepository;
  let paymentGateway: FakePaymentGateway;
  let service: OrderService;

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    paymentGateway = new FakePaymentGateway();
    service = new OrderService(orderRepo, paymentGateway);
  });

  it("should create order and charge payment", async () => {
    const result = await service.placeOrder({
      customerId: "cust-1",
      items: [{ productId: "prod-1", quantity: 2, price: 50 }],
      paymentMethod: { type: "card", token: "tok_123" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("paid");
      expect(paymentGateway.charges).toHaveLength(1);
    }
  });
});

// API integration test with Supertest
import { app } from "../src/app.js";
import request from "supertest";

describe("POST /api/users", () => {
  it("validates email format", async () => {
    const res = await request(app)
      .post("/api/users")
      .send({ name: "Test", email: "invalid" })
      .expect(400);

    expect(res.body.errors.email).toBeDefined();
  });
});
```
