# Design Patterns (Language-Agnostic)

All examples use pseudocode. For language-specific implementations, see the corresponding `*-patterns` skill.

## Creational Patterns

### Singleton
Ensures a single instance exists throughout the application lifecycle.

```
class DatabasePool:
    private static instance = null

    static getInstance():
        if instance == null:
            instance = new DatabasePool(loadConfig())
        return instance
```

**When to use:** Shared resource pools (DB connections, thread pools), configuration objects.
**When to avoid:** Most of the time. Singletons are global state -- they make testing hard and hide dependencies. Prefer dependency injection.

### Factory / Abstract Factory
Encapsulates object creation logic, decoupling creation from usage.

```
// Simple Factory
function createNotifier(channel):
    switch channel:
        "email"   -> return new EmailNotifier()
        "sms"     -> return new SmsNotifier()
        "slack"   -> return new SlackNotifier()
        default   -> throw UnknownChannel(channel)

// Abstract Factory -- family of related objects
interface UIFactory:
    createButton() -> Button
    createInput() -> Input
    createModal() -> Modal

class DarkThemeFactory implements UIFactory:
    createButton() -> return new DarkButton()
    // ...

class LightThemeFactory implements UIFactory:
    createButton() -> return new LightButton()
    // ...
```

**When to use:** Object creation depends on configuration, environment, or user input. Multiple related objects need consistent creation.

### Builder
Constructs complex objects step by step, separating construction from representation.

```
query = QueryBuilder()
    .select("name", "email")
    .from("users")
    .where("active = true")
    .orderBy("created_at", DESC)
    .limit(50)
    .build()
```

**When to use:** Objects with many optional parameters, fluent APIs, immutable object construction.

### Prototype
Creates new objects by cloning an existing instance.

```
templateOrder = Order(currency: "USD", warehouse: "US-EAST", priority: STANDARD)

// Clone and customize
newOrder = templateOrder.clone()
newOrder.setItems(items)
newOrder.setCustomer(customer)
```

**When to use:** When creating an object is expensive (DB lookup, complex initialization) and variations share most properties.

## Structural Patterns

### Adapter
Converts one interface to another, enabling incompatible systems to work together.

```
// Legacy system returns XML
class LegacyPaymentGateway:
    processXml(xmlPayload) -> xmlResponse

// New system expects JSON
class PaymentAdapter implements PaymentProcessor:
    private legacy = new LegacyPaymentGateway()

    processPayment(jsonPayment):
        xml = convertToXml(jsonPayment)
        xmlResponse = legacy.processXml(xml)
        return convertToJson(xmlResponse)
```

**When to use:** Integrating legacy systems, third-party libraries with incompatible interfaces, API version bridging.

### Decorator
Adds responsibilities to objects dynamically without subclassing.

```
// Base
interface HttpClient:
    send(request) -> response

class BaseHttpClient implements HttpClient:
    send(request) -> // actual HTTP call

// Decorators -- composable responsibilities
class LoggingClient implements HttpClient:
    private inner: HttpClient
    send(request):
        log("Sending: " + request.url)
        response = inner.send(request)
        log("Received: " + response.status)
        return response

class RetryClient implements HttpClient:
    private inner: HttpClient
    send(request):
        for attempt in 1..3:
            response = inner.send(request)
            if response.status < 500: return response
            sleep(exponentialBackoff(attempt))
        return response

class CachingClient implements HttpClient:
    private inner: HttpClient
    private cache: Map
    send(request):
        if request.method == GET and cache.has(request.url):
            return cache.get(request.url)
        response = inner.send(request)
        if request.method == GET: cache.set(request.url, response)
        return response

// Compose as needed
client = CachingClient(RetryClient(LoggingClient(BaseHttpClient())))
```

**When to use:** Cross-cutting concerns (logging, caching, retry, auth, metrics). When behavior needs to be added/removed at runtime.

### Facade
Provides a simplified interface to a complex subsystem.

```
// Complex subsystem
class OrderFacade:
    private inventory: InventoryService
    private payment: PaymentService
    private shipping: ShippingService
    private notification: NotificationService

    placeOrder(cart, customer, paymentInfo):
        // Coordinates all subsystems behind one method
        inventory.reserve(cart.items)
        receipt = payment.charge(paymentInfo, cart.total)
        tracking = shipping.createShipment(cart.items, customer.address)
        notification.sendConfirmation(customer.email, receipt, tracking)
        return OrderConfirmation(receipt, tracking)
```

**When to use:** Simplifying complex multi-service coordination, providing a clean API boundary.

### Proxy
Controls access to an object, adding a layer of indirection.

```
// Virtual Proxy (lazy loading)
class LazyImage implements Image:
    private realImage: Image = null
    private path: string

    display():
        if realImage == null:
            realImage = loadFromDisk(path)  // expensive, deferred
        realImage.display()

// Protection Proxy (access control)
class SecuredRepository implements Repository:
    private inner: Repository
    private auth: AuthService

    findById(id, token):
        if not auth.hasPermission(token, "read"):
            throw Unauthorized()
        return inner.findById(id)
```

**When to use:** Lazy initialization, access control, caching, logging, remote proxies (RPC).

### Composite
Treats individual objects and compositions uniformly (tree structures).

```
interface FileSystemNode:
    getSize() -> int
    getName() -> string

class File implements FileSystemNode:
    getSize() -> return this.bytes

class Directory implements FileSystemNode:
    private children: List<FileSystemNode>
    getSize() -> return children.sum(child -> child.getSize())
    add(node: FileSystemNode) -> children.add(node)
```

**When to use:** Tree structures (file systems, org charts, UI component trees, menu systems).

## Behavioral Patterns

### Strategy
Defines a family of interchangeable algorithms.

```
interface CompressionStrategy:
    compress(data) -> compressedData

class GzipCompression implements CompressionStrategy: // ...
class Brotli implements CompressionStrategy: // ...
class NoCompression implements CompressionStrategy: // ...

class FileProcessor:
    private strategy: CompressionStrategy

    setStrategy(s: CompressionStrategy):
        this.strategy = s

    process(file):
        compressed = strategy.compress(file.data)
        save(compressed)
```

**When to use:** Multiple algorithms for the same task, runtime algorithm selection, eliminating conditionals.

### Observer / Event-Driven

```
// In-process (pub/sub within single service)
class EventBus:
    private listeners: Map<EventType, List<Handler>>

    subscribe(event, handler):
        listeners[event].add(handler)

    publish(event):
        for handler in listeners[event.type]:
            handler(event)

bus.subscribe("order.created", inventoryHandler)
bus.subscribe("order.created", notificationHandler)
bus.publish(OrderCreated(orderId: 42))

// Cross-service: use a message broker (Kafka, RabbitMQ, SQS)
// Producer publishes to topic, consumers subscribe independently
```

**When to use:** Decoupling producers from consumers, plugin systems, UI event handling, microservice integration.

### Command
Encapsulates a request as an object, enabling undo, queuing, and logging.

```
interface Command:
    execute()
    undo()

class TransferFundsCommand implements Command:
    private from, to: Account
    private amount: Money

    execute():
        from.debit(amount)
        to.credit(amount)

    undo():
        to.debit(amount)
        from.credit(amount)

// Command queue with undo stack
class CommandProcessor:
    private history: Stack<Command>

    execute(cmd: Command):
        cmd.execute()
        history.push(cmd)

    undoLast():
        cmd = history.pop()
        cmd.undo()
```

**When to use:** Undo/redo, transaction logging, task queues, CQRS command side.

### Template Method
Defines the skeleton of an algorithm, letting subclasses override specific steps.

```
abstract class DataExporter:
    // Template method -- defines the steps
    export(query):
        data = fetchData(query)         // concrete
        validated = validate(data)       // concrete
        formatted = format(validated)    // abstract -- subclass decides
        return write(formatted)          // abstract -- subclass decides

    // Steps that subclasses override
    abstract format(data) -> string
    abstract write(formatted) -> result

class CsvExporter extends DataExporter:
    format(data) -> convertToCsv(data)
    write(formatted) -> writeToFile(formatted, ".csv")

class ApiExporter extends DataExporter:
    format(data) -> convertToJson(data)
    write(formatted) -> postToApi(formatted)
```

**When to use:** Algorithm with fixed structure but variable steps, framework hooks.

### Chain of Responsibility (Middleware)
Passes a request through a chain of handlers, each deciding to process or pass along.

```
// HTTP middleware chain
interface Middleware:
    handle(request, next) -> response

class AuthMiddleware implements Middleware:
    handle(request, next):
        if not isValidToken(request.headers["Authorization"]):
            return Response(401, "Unauthorized")
        return next(request)

class RateLimitMiddleware implements Middleware:
    handle(request, next):
        if isRateLimited(request.ip):
            return Response(429, "Too Many Requests")
        return next(request)

class LoggingMiddleware implements Middleware:
    handle(request, next):
        log("Request: " + request.method + " " + request.path)
        response = next(request)
        log("Response: " + response.status)
        return response

// Chain: Logging -> RateLimit -> Auth -> Handler
pipeline = [LoggingMiddleware, RateLimitMiddleware, AuthMiddleware]
```

**When to use:** HTTP middleware, validation pipelines, event processing, approval workflows.

### Saga (Distributed Transactions)

When a business transaction spans multiple services, use a Saga instead of distributed ACID transactions.

```
// Choreography: each service listens to events and reacts
OrderService  -> publishes OrderCreated
PaymentService -> listens OrderCreated, publishes PaymentCompleted or PaymentFailed
InventoryService -> listens PaymentCompleted, publishes InventoryReserved
ShippingService  -> listens InventoryReserved, publishes ShipmentCreated

// Compensation on failure:
PaymentFailed -> OrderService cancels order
InventoryFailed -> PaymentService refunds payment

// Orchestration: a central coordinator manages the flow
class OrderSaga:
    execute(order):
        try:
            payment.charge(order)
            inventory.reserve(order.items)
            shipping.schedule(order)
        catch PaymentFailed:
            // nothing to compensate
        catch InventoryFailed:
            payment.refund(order)
        catch ShippingFailed:
            inventory.release(order.items)
            payment.refund(order)
```

| Approach | Pros | Cons |
|----------|------|------|
| **Choreography** | Loose coupling, no single point of failure | Hard to trace, implicit flow |
| **Orchestration** | Explicit flow, easier to debug | Central coordinator, tighter coupling |

**When to use:** Any multi-service transaction where rollback/compensation is needed.

## Pattern Decision Guide

| Situation | Pattern |
|-----------|---------|
| Need single instance of shared resource | Singleton (prefer DI) |
| Object creation varies by type/config | Factory |
| Many optional constructor parameters | Builder |
| Integrating incompatible interfaces | Adapter |
| Adding behavior without modifying class | Decorator |
| Simplifying complex subsystem API | Facade |
| Lazy loading, access control, caching | Proxy |
| Tree/hierarchical structures | Composite |
| Swappable algorithms at runtime | Strategy |
| Decoupled event notification | Observer |
| Undo, queue, log operations | Command |
| Fixed algorithm, variable steps | Template Method |
| Request processing pipeline | Chain of Responsibility |
| Multi-service transactions | Saga |

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| **God Object** | One class does everything | Split by single responsibility |
| **Spaghetti Code** | No structure, everything calls everything | Layered architecture, clear boundaries |
| **Golden Hammer** | Using one pattern/tool for everything | Choose pattern based on problem |
| **Premature Optimization** | Optimizing before measuring | Profile first, optimize bottlenecks |
| **Cargo Cult** | Using patterns without understanding why | Understand the problem before applying |
| **Lava Flow** | Dead code nobody dares remove | Delete it; version control remembers |
| **Big Ball of Mud** | No discernible architecture | Refactor incrementally, add boundaries |
| **Accidental Complexity** | Architecture more complex than the problem | Simplify; YAGNI |
