# JS/TS Backend Design Patterns

## Singleton (ESM Module = Natural Singleton)
ESM modules are evaluated once and cached. A module-level instance is a singleton by default:

```typescript
// db.ts — module IS the singleton
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

// Any file importing db gets the same instance
```

When you need lazy initialization:
```typescript
class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;

  private constructor(private pool: Pool) {}

  static getInstance(): DatabaseConnection {
    if (!this.instance) {
      this.instance = new DatabaseConnection(
        new Pool({ connectionString: process.env.DATABASE_URL })
      );
    }
    return this.instance;
  }
}
```

## Factory with Registry
```typescript
interface PaymentProcessor {
  charge(amount: number): Promise<{ transactionId: string }>;
}

type ProcessorFactory = () => PaymentProcessor;

const registry = new Map<string, ProcessorFactory>();

function registerProcessor(name: string, factory: ProcessorFactory): void {
  registry.set(name, factory);
}

function createProcessor(name: string): PaymentProcessor {
  const factory = registry.get(name);
  if (!factory) throw new Error(`Unknown processor: ${name}`);
  return factory();
}

// Registration
registerProcessor("stripe", () => new StripeProcessor(process.env.STRIPE_KEY!));
registerProcessor("paypal", () => new PayPalProcessor(process.env.PAYPAL_ID!));

// Usage
const processor = createProcessor(config.paymentProvider);
```

## Builder (Fluent API)
```typescript
class QueryBuilder<T> {
  private filters: Array<(item: T) => boolean> = [];
  private sortFn?: (a: T, b: T) => number;
  private limitCount?: number;

  where(predicate: (item: T) => boolean): this {
    this.filters.push(predicate);
    return this;
  }

  orderBy(compareFn: (a: T, b: T) => number): this {
    this.sortFn = compareFn;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  execute(data: T[]): T[] {
    let result = data.filter((item) => this.filters.every((f) => f(item)));
    if (this.sortFn) result.sort(this.sortFn);
    if (this.limitCount) result = result.slice(0, this.limitCount);
    return result;
  }
}

// Usage
const users = new QueryBuilder<User>()
  .where((u) => u.age >= 18)
  .where((u) => u.active)
  .orderBy((a, b) => a.name.localeCompare(b.name))
  .limit(10)
  .execute(allUsers);
```

## Decorator (TC39 Stage 3)
```typescript
function cached(ttlMs: number) {
  return function <T extends (...args: unknown[]) => unknown>(
    target: T,
    context: ClassMethodDecoratorContext
  ) {
    const cache = new Map<string, { value: unknown; expiry: number }>();

    return function (this: unknown, ...args: unknown[]) {
      const key = JSON.stringify(args);
      const entry = cache.get(key);
      if (entry && entry.expiry > Date.now()) return entry.value;

      const result = target.apply(this, args);
      cache.set(key, { value: result, expiry: Date.now() + ttlMs });
      return result;
    } as T;
  };
}

class UserService {
  @cached(60_000) // 1 minute TTL
  async getUser(id: string) {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  }
}
```

## Proxy (Audit / Logging)
```typescript
function withAuditLog<T extends object>(target: T, logger: Logger): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          logger.info({ method: String(prop), args }, "method called");
          return value.apply(obj, args);
        };
      }
      return value;
    },
  });
}

const service = withAuditLog(new OrderService(), logger);
```

## Facade (Multi-Service Orchestration)
```typescript
class CheckoutFacade {
  constructor(
    private inventory: InventoryService,
    private payment: PaymentService,
    private shipping: ShippingService,
    private notification: NotificationService
  ) {}

  async checkout(order: Order): Promise<CheckoutResult> {
    // Orchestrates multiple services behind a simple interface
    await this.inventory.reserve(order.items);

    const payment = await this.payment.charge(order.total, order.paymentMethod);
    if (!payment.success) {
      await this.inventory.release(order.items);
      return { success: false, error: "Payment failed" };
    }

    const tracking = await this.shipping.createShipment(order);
    await this.notification.sendConfirmation(order.email, tracking);

    return { success: true, trackingNumber: tracking.id };
  }
}
```

## Strategy (Two Approaches)

### With union types and a Map
```typescript
type CompressionAlgorithm = "gzip" | "brotli" | "deflate";
type CompressFn = (data: Buffer) => Promise<Buffer>;

const strategies: Record<CompressionAlgorithm, CompressFn> = {
  gzip: (data) => gzipAsync(data),
  brotli: (data) => brotliCompressAsync(data),
  deflate: (data) => deflateAsync(data),
};

async function compress(data: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
  return strategies[algorithm](data);
}
```

### With pure functions (no class needed)
```typescript
interface PricingStrategy {
  calculate(basePrice: number, quantity: number): number;
}

const regularPricing: PricingStrategy = {
  calculate: (price, qty) => price * qty,
};

const bulkPricing: PricingStrategy = {
  calculate: (price, qty) => price * qty * (qty > 100 ? 0.8 : qty > 50 ? 0.9 : 1),
};

const premiumPricing: PricingStrategy = {
  calculate: (price, qty) => price * qty * 1.2, // premium markup
};
```

## Observer (Typed EventEmitter)
```typescript
import { EventEmitter } from "node:events";

interface OrderEvents {
  "order:created": [order: Order];
  "order:paid": [order: Order, payment: Payment];
  "order:shipped": [order: Order, tracking: string];
  "order:failed": [order: Order, error: Error];
}

class TypedEmitter<T extends Record<string, unknown[]>> {
  private emitter = new EventEmitter();

  on<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean {
    return this.emitter.emit(event, ...args);
  }
}

const orderBus = new TypedEmitter<OrderEvents>();
orderBus.on("order:created", (order) => sendConfirmationEmail(order));
orderBus.on("order:paid", (order, payment) => updateAccounting(order, payment));
```

## Repository Pattern
```typescript
// Port (interface)
interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
}

// Adapter (Drizzle implementation)
class DrizzleUserRepository implements UserRepository {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] ?? null;
  }

  async save(user: User): Promise<User> {
    const [saved] = await this.db.insert(users).values(user).onConflictDoUpdate({
      target: users.id,
      set: { name: user.name, email: user.email, updatedAt: new Date() },
    }).returning();
    return saved;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, id));
  }
}

// Test adapter — no mocking framework needed
class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  async findById(id: string) { return this.store.get(id) ?? null; }
  async findByEmail(email: string) {
    return [...this.store.values()].find((u) => u.email === email) ?? null;
  }
  async save(user: User) { this.store.set(user.id, user); return user; }
  async delete(id: string) { this.store.delete(id); }
}
```

## Result Pattern (Ok/Err Without Exceptions)
```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Usage
type ValidationError = { field: string; message: string };

function validateEmail(input: string): Result<string, ValidationError> {
  if (!input.includes("@")) {
    return err({ field: "email", message: "Invalid email format" });
  }
  return ok(input.toLowerCase().trim());
}

// Caller handles both cases explicitly
const result = validateEmail(input);
if (!result.ok) {
  logger.warn({ error: result.error }, "Validation failed");
  return reply.status(400).send(result.error);
}
// result.value is narrowed to string here
```

## Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|-------------|---------|-----------------|
| God service | Single class with 50+ methods | Split by domain (UserService, OrderService) |
| Anemic domain | Objects with only getters/setters, all logic in services | Rich domain models with behavior |
| Service locator | Global registry resolved at runtime | Constructor injection (explicit deps) |
| Callback hell | Nested callbacks, impossible error handling | async/await with proper error boundaries |
| Mutable shared state | Global variables mutated by multiple modules | Immutable data, explicit state passing |
| String-typed IDs | `userId: string` accepted everywhere | Branded types or newtype (`UserId`) |
| Catch-and-ignore | `catch (e) {}` — silent failures | Always log, re-throw, or return Result |
| Promise constructor anti-pattern | `new Promise((resolve) => resolve(asyncFn()))` | Return the promise directly |
