# Java Best Practices (2024-2025)

## Exception Handling

### Domain exceptions with hierarchy
```java
public abstract class DomainException extends RuntimeException {
    private final String code;
    protected DomainException(String code, String message) {
        super(message);
        this.code = code;
    }
    public String code() { return code; }
}

public class OrderNotFoundException extends DomainException {
    public OrderNotFoundException(String orderId) {
        super("ORDER_NOT_FOUND", "Order not found: " + orderId);
    }
}

public class InsufficientStockException extends DomainException {
    public InsufficientStockException(String productId, int requested, int available) {
        super("INSUFFICIENT_STOCK",
              "Product %s: requested %d, available %d".formatted(productId, requested, available));
    }
}
```

### Global handler with @RestControllerAdvice
```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomain(DomainException ex) {
        log.warn("Domain error: {}", ex.getMessage());
        return ResponseEntity.badRequest()
            .body(new ErrorResponse(ex.code(), ex.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unexpected error", ex);
        return ResponseEntity.internalServerError()
            .body(new ErrorResponse("INTERNAL_ERROR", "An unexpected error occurred"));
    }
}

public record ErrorResponse(String code, String message) {}
```

## Immutability and Records

### Records for DTOs and Value Objects
```java
// Request DTO
public record CreateOrderRequest(
    @NotBlank String customerId,
    @NotEmpty List<OrderItemRequest> items
) {}

// Response DTO
public record OrderResponse(String id, String status, BigDecimal total, Instant createdAt) {
    public static OrderResponse from(Order order) {
        return new OrderResponse(order.id().value(), order.status().name(),
                                  order.total().amount(), order.createdAt());
    }
}

// Value Object with validation in compact constructor
public record Email(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[\\w.-]+@[\\w.-]+\\.[a-zA-Z]{2,}$");
    public Email {
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid email: " + value);
        }
    }
}
```

## SOLID Principles

| Principle | Java Implementation |
|-----------|-------------------|
| **S** — Single Responsibility | One class = one reason to change. Services, repositories, controllers are separate |
| **O** — Open/Closed | Use `sealed interface` + pattern matching instead of if-else chains |
| **L** — Liskov Substitution | Subtypes must be substitutable. Prefer composition over inheritance |
| **I** — Interface Segregation | Small focused interfaces: `Readable`, `Writable` vs `ReadWriteStore` |
| **D** — Dependency Inversion | Depend on interfaces (ports), inject implementations via constructor |

## Logging with SLF4J

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);

// GOOD: parameterized logging (evaluated only if level is enabled)
log.info("Order {} placed for customer {}", orderId, customerId);
log.debug("Processing {} items with total {}", items.size(), total);
log.error("Failed to process order {}", orderId, exception);

// BAD: string concatenation (always evaluated, even if level disabled)
// log.info("Order " + orderId + " placed");    // NEVER do this
// log.debug("Items: " + items.toString());      // NEVER do this
```

Use `@Slf4j` (Lombok) to avoid boilerplate logger declarations.

## Memory Management

### GC selection
- **G1GC**: Default since Java 9, good general-purpose (use for most apps)
- **ZGC**: Sub-millisecond pauses, ideal for latency-sensitive apps (`-XX:+UseZGC`)
- **Shenandoah**: Low-pause alternative to ZGC (Red Hat)

### Resource management
```java
// Always use try-with-resources for AutoCloseable
try (var conn = dataSource.getConnection();
     var stmt = conn.prepareStatement(sql);
     var rs = stmt.executeQuery()) {
    while (rs.next()) { /* process */ }
}
// Connection, statement, and result set are ALL closed automatically

// JFR (Java Flight Recorder) for production profiling
// -XX:StartFlightRecording=duration=60s,filename=recording.jfr
```

## Streams Best Practices

```java
// GOOD: pure transformations, no side effects
var activeUsers = users.stream()
    .filter(User::isActive)
    .map(User::email)
    .sorted()
    .toList();  // Java 16+ — prefer over .collect(Collectors.toList())

// GOOD: flatMap for nested collections
var allTags = articles.stream()
    .flatMap(article -> article.tags().stream())
    .distinct()
    .toList();

// GOOD: groupingBy for categorization
var byStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status));

// GOOD: teeing collector (Java 12+)
var stats = numbers.stream()
    .collect(Collectors.teeing(
        Collectors.minBy(Comparator.naturalOrder()),
        Collectors.maxBy(Comparator.naturalOrder()),
        (min, max) -> new Stats(min.orElse(0), max.orElse(0))
    ));

// BAD: side effects in streams
// list.stream().forEach(item -> externalList.add(item));  // NEVER mutate external state
```

## Optional Usage

```java
// GOOD: as return type for nullable results
public Optional<User> findByEmail(String email) {
    return Optional.ofNullable(userMap.get(email));
}

// GOOD: chaining operations
var displayName = findByEmail(email)
    .map(User::displayName)
    .orElse("Anonymous");

// GOOD: orElseThrow for required values
var user = findByEmail(email)
    .orElseThrow(() -> new UserNotFoundException(email));

// BAD: as method parameter — use overloading or @Nullable instead
// void process(Optional<String> name)  // NEVER do this

// BAD: calling .get() without check
// user.get()  // NEVER — use orElseThrow() or orElse()

// BAD: wrapping non-null values
// Optional.of(computeValue())  // Pointless if value is never null
```

## Concurrency

### Virtual Threads (Java 21+)
```java
// Create millions of lightweight threads for I/O-bound work
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = urls.stream()
        .map(url -> executor.submit(() -> fetchData(url)))
        .toList();
    var results = futures.stream()
        .map(f -> { try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); } })
        .toList();
}

// Spring Boot 3.2+: enable virtual threads
// spring.threads.virtual.enabled=true
```

### Thread-safe collections
```java
// Use ConcurrentHashMap for concurrent access
private final Map<String, Session> sessions = new ConcurrentHashMap<>();

// Use AtomicLong for counters
private final AtomicLong requestCount = new AtomicLong();
requestCount.incrementAndGet();

// Use synchronized only for small critical sections
synchronized (lock) {
    // Minimal work here
}
```

## Collections Best Practices

```java
// Declare with interface types
List<String> names = new ArrayList<>();       // not ArrayList<String> names
Map<String, User> cache = new HashMap<>();    // not HashMap<String, User> cache

// Use immutable collections for constants and returns
var SUPPORTED = List.of("json", "xml", "yaml");      // unmodifiable
var copy = List.copyOf(mutableList);                  // defensive copy
var map = Map.of("key1", "val1", "key2", "val2");    // unmodifiable map

// Never expose mutable internals
public List<OrderLine> lines() {
    return Collections.unmodifiableList(lines);  // or List.copyOf(lines)
}

// Use Stream.toList() (Java 16+) instead of .collect(Collectors.toList())
var filtered = items.stream().filter(Item::isValid).toList();
```

## Constructor Injection (not field injection)
```java
// GOOD: constructor injection — testable, immutable, explicit dependencies
@Service
public class OrderService {
    private final OrderRepository repository;
    private final PaymentProcessor payment;
    private final NotificationService notifications;

    // Single constructor — Spring auto-injects, no @Autowired needed
    public OrderService(OrderRepository repository, PaymentProcessor payment,
                        NotificationService notifications) {
        this.repository = repository;
        this.payment = payment;
        this.notifications = notifications;
    }
}

// BAD: field injection — hides dependencies, hard to test
// @Autowired private OrderRepository repository;  // NEVER do this
```
