# Java Design Patterns

## Singleton (thread-safe with Holder pattern)
The Initialization-on-demand holder idiom — lazy, thread-safe, no synchronization:
```java
public class Registry {
    private Registry() {}

    private static class Holder {
        static final Registry INSTANCE = new Registry();
    }

    public static Registry getInstance() {
        return Holder.INSTANCE;
    }
}
```
The JVM guarantees class loading is thread-safe. No `volatile`, no `synchronized`.
Alternative: use an `enum` singleton for serialization safety.

## Factory Method (with switch expressions)
```java
public sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {}

public record EmailNotification(String to, String subject, String body) implements Notification {}
public record SmsNotification(String phone, String message) implements Notification {}
public record PushNotification(String deviceId, String payload) implements Notification {}

public static Notification create(String type, Map<String, String> params) {
    return switch (type) {
        case "email" -> new EmailNotification(params.get("to"), params.get("subject"), params.get("body"));
        case "sms"   -> new SmsNotification(params.get("phone"), params.get("message"));
        case "push"  -> new PushNotification(params.get("deviceId"), params.get("payload"));
        default      -> throw new IllegalArgumentException("Unknown notification type: " + type);
    };
}
```

## Builder (with Records + manual builder)
Records are immutable by default — use a builder for complex construction:
```java
public record ServerConfig(String host, int port, int maxConnections, Duration timeout) {

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private String host = "localhost";
        private int port = 8080;
        private int maxConnections = 100;
        private Duration timeout = Duration.ofSeconds(30);

        public Builder host(String host) { this.host = host; return this; }
        public Builder port(int port) { this.port = port; return this; }
        public Builder maxConnections(int max) { this.maxConnections = max; return this; }
        public Builder timeout(Duration timeout) { this.timeout = timeout; return this; }

        public ServerConfig build() {
            return new ServerConfig(host, port, maxConnections, timeout);
        }
    }
}

// Usage
var config = ServerConfig.builder().host("api.example.com").port(443).build();
```

## Adapter Pattern
```java
// Target interface expected by the application
public interface PaymentProcessor {
    PaymentResult process(Order order);
}

// Adapter wrapping a third-party SDK
public class StripePaymentAdapter implements PaymentProcessor {
    private final StripeClient client;

    public StripePaymentAdapter(StripeClient client) { this.client = client; }

    @Override
    public PaymentResult process(Order order) {
        var charge = client.createCharge(order.totalCents(), order.currency());
        return new PaymentResult(charge.id(), charge.status().equals("succeeded"));
    }
}
```

## Decorator Pattern
```java
public interface MessageSender {
    void send(String message);
}

public class LoggingMessageSender implements MessageSender {
    private final MessageSender delegate;
    private static final Logger log = LoggerFactory.getLogger(LoggingMessageSender.class);

    public LoggingMessageSender(MessageSender delegate) { this.delegate = delegate; }

    @Override
    public void send(String message) {
        log.info("Sending message: {}", message);
        delegate.send(message);
        log.info("Message sent successfully");
    }
}
```

## Facade Pattern
```java
public class OrderFacade {
    private final InventoryService inventory;
    private final PaymentProcessor payment;
    private final ShippingService shipping;
    private final NotificationService notifications;

    public OrderFacade(InventoryService inv, PaymentProcessor pay,
                       ShippingService ship, NotificationService notif) {
        this.inventory = inv; this.payment = pay;
        this.shipping = ship; this.notifications = notif;
    }

    public OrderResult placeOrder(Order order) {
        inventory.reserve(order.items());
        var paymentResult = payment.process(order);
        var tracking = shipping.schedule(order);
        notifications.sendConfirmation(order, tracking);
        return new OrderResult(paymentResult, tracking);
    }
}
```

## Strategy Pattern (with @FunctionalInterface and lambdas)
```java
@FunctionalInterface
public interface PricingStrategy {
    BigDecimal calculatePrice(BigDecimal basePrice, int quantity);
}

// Strategies as lambdas or method references
public class PricingStrategies {
    public static final PricingStrategy STANDARD =
        (price, qty) -> price.multiply(BigDecimal.valueOf(qty));

    public static final PricingStrategy BULK_DISCOUNT =
        (price, qty) -> qty >= 10
            ? price.multiply(BigDecimal.valueOf(qty)).multiply(BigDecimal.valueOf(0.9))
            : STANDARD.calculatePrice(price, qty);

    public static final PricingStrategy TIERED = (price, qty) -> switch (qty) {
        case int q when q >= 100 -> price.multiply(BigDecimal.valueOf(q * 0.7));
        case int q when q >= 50  -> price.multiply(BigDecimal.valueOf(q * 0.8));
        case int q when q >= 10  -> price.multiply(BigDecimal.valueOf(q * 0.9));
        default -> STANDARD.calculatePrice(price, qty);
    };
}
```

## Observer (with Spring Events)
```java
// Event (use record for immutability)
public record OrderPlacedEvent(String orderId, BigDecimal total, Instant timestamp) {}

// Publisher
@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;

    public OrderService(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    public void placeOrder(Order order) {
        // ... save order
        publisher.publishEvent(new OrderPlacedEvent(order.id(), order.total(), Instant.now()));
    }
}

// Listeners (decoupled, can be async)
@Component
public class InventoryListener {
    @EventListener
    public void onOrderPlaced(OrderPlacedEvent event) {
        // Reserve inventory
    }
}

@Component
public class NotificationListener {
    @Async
    @EventListener
    public void onOrderPlaced(OrderPlacedEvent event) {
        // Send confirmation email (async — won't block publisher)
    }
}
```

## Template Method
```java
public abstract class DataImporter<T> {
    public final void importData(Path source) {
        var rawData = readSource(source);
        var validated = validate(rawData);
        var entities = transform(validated);
        save(entities);
    }

    protected abstract List<String> readSource(Path source);
    protected abstract List<String> validate(List<String> raw);
    protected abstract List<T> transform(List<String> validated);
    protected abstract void save(List<T> entities);
}
```

## Anti-patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| God Class | Class with 2000+ lines, 30+ methods | Split by responsibility (SRP) |
| Anemic Domain Model | Entities are pure data, logic in services | Move behavior into domain objects |
| Service Locator | Hidden dependencies via static lookup | Use constructor injection |
| Singleton Abuse | Global mutable state, untestable | Use DI container scoping instead |
| Primitive Obsession | Using `String` for email, `int` for IDs | Use Value Objects or Records |
| Exception Swallowing | `catch (Exception e) {}` | Log + rethrow or handle properly |
| Copy-Paste Inheritance | Overriding everything in subclass | Use composition (Strategy, Decorator) |
