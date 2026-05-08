# Java Architecture Patterns

## Hexagonal Architecture (Ports & Adapters)
Spring naturally supports this — interfaces as ports, beans as adapters:

```java
// Port (domain interface — no framework annotations)
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    OrderId save(Order order);
}

// Adapter (infrastructure — Spring annotations here)
@Repository
public class JpaOrderRepository implements OrderRepository {
    private final JpaOrderEntityRepository jpaRepo;
    private final OrderMapper mapper;

    @Override
    public Optional<Order> findById(OrderId id) {
        return jpaRepo.findById(id.value()).map(mapper::toDomain);
    }

    @Override
    public OrderId save(Order order) {
        var entity = mapper.toEntity(order);
        return new OrderId(jpaRepo.save(entity).getId());
    }
}

// Application service (orchestration, depends only on ports)
@Service
@Transactional
public class PlaceOrderUseCase {
    private final OrderRepository orders;
    private final PaymentPort payments;
    private final ApplicationEventPublisher events;

    public PlaceOrderUseCase(OrderRepository orders, PaymentPort payments,
                              ApplicationEventPublisher events) {
        this.orders = orders;
        this.payments = payments;
        this.events = events;
    }

    public OrderId execute(PlaceOrderCommand cmd) {
        var order = Order.create(cmd.customerId(), cmd.items());
        payments.charge(order.total(), cmd.paymentMethod());
        var id = orders.save(order);
        events.publishEvent(new OrderPlacedEvent(id));
        return id;
    }
}
```

## Event-Driven Architecture (Kafka)
```java
// Producer
@Service
public class OrderEventPublisher {
    private final KafkaTemplate<String, OrderEvent> kafka;

    public void publish(OrderEvent event) {
        kafka.send("orders", event.orderId(), event)
             .whenComplete((result, ex) -> {
                 if (ex != null) log.error("Failed to publish event: {}", event, ex);
             });
    }
}

// Consumer
@Component
public class OrderEventConsumer {
    @KafkaListener(topics = "orders", groupId = "inventory-service")
    public void onOrderEvent(OrderEvent event) {
        switch (event) {
            case OrderPlaced placed -> inventoryService.reserve(placed.items());
            case OrderCancelled cancelled -> inventoryService.release(cancelled.items());
        }
    }
}
```

## CQRS (Command Query Responsibility Segregation)
```java
// Command side — domain model, transactional
@Service
public class OrderCommandService {
    private final OrderRepository repository;

    @Transactional
    public OrderId createOrder(CreateOrderCommand cmd) {
        var order = Order.create(cmd.customerId(), cmd.items());
        return repository.save(order);
    }
}

// Query side — optimized read model, denormalized
@Service
public class OrderQueryService {
    private final JdbcTemplate jdbc;

    public OrderSummaryDto findSummary(String orderId) {
        return jdbc.queryForObject(
            "SELECT id, customer_name, total, status FROM order_summary_view WHERE id = ?",
            (rs, _) -> new OrderSummaryDto(rs.getString("id"), rs.getString("customer_name"),
                                            rs.getBigDecimal("total"), rs.getString("status")),
            orderId
        );
    }
}
```

## Clean Architecture Layers
```
Domain (innermost)        — Entities, Value Objects, Domain Events, Repository interfaces
Application               — Use cases, DTOs, port interfaces
Infrastructure (outer)    — JPA repos, Kafka adapters, REST clients, config
Presentation (outermost)  — Controllers, request/response models
```
Dependencies point inward. Domain has zero framework imports.

## DDD (Domain-Driven Design)

### Aggregate Root
```java
public class Order {
    private OrderId id;
    private CustomerId customerId;
    private List<OrderLine> lines;
    private OrderStatus status;
    private final List<DomainEvent> domainEvents = new ArrayList<>();

    public void addItem(ProductId productId, int quantity, Money price) {
        if (status != OrderStatus.DRAFT) {
            throw new OrderAlreadySubmittedException(id);
        }
        lines.add(new OrderLine(productId, quantity, price));
        domainEvents.add(new ItemAddedEvent(id, productId, quantity));
    }

    public Money total() {
        return lines.stream()
            .map(OrderLine::subtotal)
            .reduce(Money.ZERO, Money::add);
    }

    public List<DomainEvent> domainEvents() {
        return Collections.unmodifiableList(domainEvents);
    }
}
```

### Value Objects with Records
```java
public record Money(BigDecimal amount, Currency currency) {
    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.getInstance("USD"));

    public Money {
        if (amount.scale() > 2) throw new IllegalArgumentException("Max 2 decimal places");
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) throw new CurrencyMismatchException();
        return new Money(amount.add(other.amount), currency);
    }
}

public record OrderId(String value) {
    public OrderId { Objects.requireNonNull(value, "OrderId cannot be null"); }
}
```

### Domain Events
```java
public sealed interface DomainEvent permits ItemAddedEvent, OrderSubmittedEvent, OrderCancelledEvent {
    Instant occurredAt();
}

public record ItemAddedEvent(OrderId orderId, ProductId productId, int quantity,
                              Instant occurredAt) implements DomainEvent {
    public ItemAddedEvent(OrderId orderId, ProductId productId, int quantity) {
        this(orderId, productId, quantity, Instant.now());
    }
}
```

## Circuit Breaker with Resilience4j
```java
@Service
public class PaymentService {
    private final CircuitBreaker circuitBreaker;
    private final PaymentGateway gateway;

    public PaymentService(CircuitBreakerRegistry registry, PaymentGateway gateway) {
        this.circuitBreaker = registry.circuitBreaker("payment",
            CircuitBreakerConfig.custom()
                .failureRateThreshold(50)
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .slidingWindowSize(10)
                .build());
        this.gateway = gateway;
    }

    public PaymentResult charge(Money amount, PaymentMethod method) {
        return circuitBreaker.executeSupplier(() -> gateway.charge(amount, method));
    }
}

// Or with annotations (Spring Boot + resilience4j-spring-boot3)
@CircuitBreaker(name = "payment", fallbackMethod = "fallbackCharge")
public PaymentResult charge(Money amount, PaymentMethod method) {
    return gateway.charge(amount, method);
}
```

## Project Structure
```
com.example.myapp/
  domain/
    model/              # Entities, Aggregate Roots, Value Objects
    event/              # Domain Events
    repository/         # Repository interfaces (ports)
    exception/          # Domain exceptions
  application/
    usecase/            # Application services / use cases
    dto/                # Command/Query DTOs
    port/               # Outbound port interfaces
  infrastructure/
    persistence/        # JPA entities, Spring Data repos (adapters)
    messaging/          # Kafka producers/consumers
    config/             # Spring configuration classes
    client/             # External API clients
  presentation/
    rest/               # @RestController classes
    advice/             # @RestControllerAdvice (global error handling)
    mapper/             # Request/Response <-> DTO mappers
```

### Module structure (multi-module Maven/Gradle)
```
my-app/
  my-app-domain/        # Zero dependencies
  my-app-application/   # Depends on domain
  my-app-infrastructure/# Depends on application + domain
  my-app-api/           # Depends on all, contains main class
  pom.xml               # Parent POM with shared dependencies
```
Build tool enforces dependency direction.
