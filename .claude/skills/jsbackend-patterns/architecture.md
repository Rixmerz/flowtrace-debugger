# JS/TS Backend Architecture Patterns

## Hexagonal Architecture (Ports & Adapters)
TypeScript interfaces serve as ports. No DI framework required for simple cases:

```typescript
// === Domain (innermost layer, no dependencies) ===
interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  save(order: Order): Promise<Order>;
}

interface PaymentGateway {
  charge(amount: number, method: PaymentMethod): Promise<ChargeResult>;
  refund(transactionId: string): Promise<RefundResult>;
}

interface NotificationPort {
  send(to: string, message: string): Promise<void>;
}

// === Application Service (uses ports, pure business logic) ===
class OrderService {
  constructor(
    private orders: OrderRepository,
    private payments: PaymentGateway,
    private notifications: NotificationPort
  ) {}

  async placeOrder(dto: CreateOrderDTO): Promise<Result<Order, OrderError>> {
    const order = Order.create(dto);
    const charge = await this.payments.charge(order.total, dto.paymentMethod);
    if (!charge.success) return err(OrderError.PaymentFailed);

    order.markPaid(charge.transactionId);
    const saved = await this.orders.save(order);
    await this.notifications.send(dto.email, `Order ${saved.id} confirmed`);
    return ok(saved);
  }
}

// === Adapters (outermost layer, concrete implementations) ===
class PostgresOrderRepository implements OrderRepository { /* Drizzle/Prisma */ }
class StripePaymentGateway implements PaymentGateway { /* Stripe SDK */ }
class EmailNotificationAdapter implements NotificationPort { /* SendGrid/SES */ }

// === Composition Root (wiring) ===
const orderService = new OrderService(
  new PostgresOrderRepository(db),
  new StripePaymentGateway(stripeKey),
  new EmailNotificationAdapter(sesClient)
);
```

## Event-Driven Architecture

### Kafka Producer/Consumer with kafkajs
```typescript
import { Kafka, logLevel } from "kafkajs";

const kafka = new Kafka({
  clientId: "order-service",
  brokers: [process.env.KAFKA_BROKER!],
  logLevel: logLevel.WARN,
});

// Producer
const producer = kafka.producer();
await producer.connect();

async function publishOrderEvent(order: Order, event: string): Promise<void> {
  await producer.send({
    topic: "orders",
    messages: [{
      key: order.id,
      value: JSON.stringify({ event, order, timestamp: Date.now() }),
      headers: { "event-type": event },
    }],
  });
}

// Consumer
const consumer = kafka.consumer({ groupId: "inventory-service" });
await consumer.connect();
await consumer.subscribe({ topic: "orders", fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const event = JSON.parse(message.value!.toString());
    switch (event.event) {
      case "order:created":
        await reserveInventory(event.order);
        break;
      case "order:cancelled":
        await releaseInventory(event.order);
        break;
    }
  },
});
```

### BullMQ Job Queue
```typescript
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL!);

// Queue
const emailQueue = new Queue("emails", { connection });

await emailQueue.add("welcome", { userId: "123", email: "user@example.com" }, {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});

// Worker
const worker = new Worker("emails", async (job) => {
  switch (job.name) {
    case "welcome":
      await sendWelcomeEmail(job.data.email);
      break;
    case "invoice":
      await generateAndSendInvoice(job.data);
      break;
  }
}, { connection, concurrency: 5 });

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Job failed");
});
```

## CQRS (Command Query Responsibility Segregation)
```typescript
// === Commands (write side) ===
interface Command {
  readonly type: string;
}

interface CreateOrderCommand extends Command {
  type: "CreateOrder";
  customerId: string;
  items: OrderItem[];
}

interface CancelOrderCommand extends Command {
  type: "CancelOrder";
  orderId: string;
  reason: string;
}

type CommandHandler<C extends Command> = (command: C) => Promise<Result<void, AppError>>;

class CommandBus {
  private handlers = new Map<string, CommandHandler<never>>();

  register<C extends Command>(type: C["type"], handler: CommandHandler<C>): void {
    this.handlers.set(type, handler as CommandHandler<never>);
  }

  async dispatch<C extends Command>(command: C): Promise<Result<void, AppError>> {
    const handler = this.handlers.get(command.type);
    if (!handler) return err(new AppError(`No handler for ${command.type}`));
    return handler(command);
  }
}

// === Queries (read side, can use denormalized views) ===
interface OrderSummaryQuery {
  customerId: string;
  status?: OrderStatus;
  limit?: number;
}

class OrderQueryService {
  // Reads from read-optimized view/table, not the write model
  async getOrderSummaries(query: OrderSummaryQuery): Promise<OrderSummary[]> {
    return db.select().from(orderSummaryView)
      .where(eq(orderSummaryView.customerId, query.customerId))
      .limit(query.limit ?? 20);
  }
}
```

## Clean Architecture Dependency Layers
```
src/
  domain/              # Entities, value objects, domain errors (NO imports from outer layers)
    entities/
    value-objects/
    errors.ts
  application/         # Use cases, port interfaces (imports only domain)
    use-cases/
    ports/             # Repository & service interfaces
    dtos/
  infrastructure/      # Adapters: DB, HTTP clients, queues (imports application + domain)
    persistence/       # Repository implementations
    messaging/         # Kafka/BullMQ producers
    http/              # External API clients
  presentation/        # HTTP handlers, routes (imports application)
    routes/
    middleware/
    validators/        # Zod schemas for request validation
  config/              # Environment, DI container setup
    env.ts
    container.ts
```

Dependency rule: each layer can only import from layers **inside** it (domain is innermost).

## Result Pattern for Typed Errors
```typescript
// Domain errors as discriminated unions
type OrderError =
  | { type: "NOT_FOUND"; orderId: string }
  | { type: "ALREADY_PAID"; orderId: string }
  | { type: "INSUFFICIENT_STOCK"; itemId: string; available: number }
  | { type: "PAYMENT_FAILED"; reason: string };

type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Use case returns typed Result
async function cancelOrder(
  orderId: string,
  repo: OrderRepository
): Promise<Result<Order, OrderError>> {
  const order = await repo.findById(orderId);
  if (!order) return { ok: false, error: { type: "NOT_FOUND", orderId } };
  if (order.status === "paid") return { ok: false, error: { type: "ALREADY_PAID", orderId } };

  order.cancel();
  const saved = await repo.save(order);
  return { ok: true, value: saved };
}

// Route handler maps Result to HTTP response
app.delete("/orders/:id", async (req, reply) => {
  const result = await cancelOrder(req.params.id, orderRepo);
  if (!result.ok) {
    switch (result.error.type) {
      case "NOT_FOUND": return reply.status(404).send(result.error);
      case "ALREADY_PAID": return reply.status(409).send(result.error);
      default: return reply.status(400).send(result.error);
    }
  }
  return reply.status(200).send(result.value);
});
```

## Graceful Shutdown Pattern
```typescript
import { once } from "node:events";

class GracefulShutdown {
  private cleanupFns: Array<{ name: string; fn: () => Promise<void> }> = [];
  private isShuttingDown = false;

  register(name: string, fn: () => Promise<void>): void {
    this.cleanupFns.push({ name, fn });
  }

  listen(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      logger.info({ signal }, "Shutdown signal received");

      // Close resources in reverse order (LIFO)
      for (const { name, fn } of [...this.cleanupFns].reverse()) {
        try {
          await Promise.race([fn(), new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 10_000)
          )]);
          logger.info({ resource: name }, "Closed");
        } catch (err) {
          logger.error({ resource: name, err }, "Failed to close");
        }
      }

      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Usage
const shutdown = new GracefulShutdown();

// Register in order of creation (will close in reverse)
shutdown.register("database", () => pool.end());
shutdown.register("redis", () => redis.quit());
shutdown.register("kafka-producer", () => producer.disconnect());
shutdown.register("kafka-consumer", () => consumer.disconnect());
shutdown.register("http-server", () => new Promise<void>((resolve) => {
  server.close(() => resolve());
}));
shutdown.register("bullmq-worker", () => worker.close());

shutdown.listen();
```

## Project Structure (Recommended)
```
project/
  src/
    domain/
      entities/
        user.ts
        order.ts
      value-objects/
        email.ts           # Branded type: type Email = string & { __brand: "Email" }
        money.ts
      errors.ts            # Domain error union types
    application/
      use-cases/
        create-order.ts
        cancel-order.ts
      ports/
        user-repository.ts # Interface
        payment-gateway.ts # Interface
    infrastructure/
      persistence/
        drizzle/
          schema.ts        # Drizzle table definitions
          user-repository.ts
        migrations/
      messaging/
        kafka-producer.ts
        bullmq-queues.ts
      external/
        stripe-gateway.ts
    presentation/
      routes/
        users.ts
        orders.ts
      middleware/
        auth.ts
        error-handler.ts
      validators/
        create-order.schema.ts  # Zod schemas
    config/
      env.ts               # Validated config (Zod + process.env)
      container.ts          # Dependency wiring
    server.ts              # App bootstrap
  drizzle.config.ts
  vitest.config.ts
  tsconfig.json
  package.json
```
