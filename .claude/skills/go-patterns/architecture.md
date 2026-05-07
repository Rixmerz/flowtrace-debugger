# Go Architecture Patterns

## Clean Architecture (Go-adapted)
```
cmd/api/main.go              -> composition root
internal/
  domain/                     -> entities, business rules (no infra imports)
  service/                    -> use cases / application logic
  handler/                    -> HTTP/gRPC adapters
  repository/                 -> persistence implementations
```
Community consensus: use Clean Architecture **concepts** (dependency inversion, separation of concerns) but adapt structure to Go idioms. Don't rigidly follow Uncle Bob's layers.

## Hexagonal (Ports & Adapters)
Natural fit for Go thanks to implicit interfaces:
```go
// Port (domain interface)
type OrderRepository interface { Save(ctx context.Context, order *Order) error }
// Adapter (infra)
type PostgresOrderRepo struct { pool *pgxpool.Pool }
// Service (depends only on port)
type OrderService struct { repo OrderRepository }
```

## Vertical Slice
```
features/create-user/ -> command, handler, controller, validator, test
features/get-user/    -> query, handler, test
```

## Project Layout
**`golang-standards/project-layout` is controversial** — NOT affiliated with the Go team. Russ Cox: "This is not a standard Go project layout."

Pragmatic recommendation:
- `cmd/` for multiple binaries
- `internal/` for private packages (enforced by toolchain)
- Keep everything else flat. Add structure only when needed

## DDD + gRPC Microservices
- **ThreeDotsLabs/wild-workouts-go-ddd-example**: Best DDD + Clean + CQRS reference
- **Watermill**: Event sourcing and CQRS with broker abstraction
- Hexagonal per microservice, gRPC as primary adapter, context propagation

## Best Practices

### context.Context
- Always first parameter: `func GetUser(ctx context.Context, id string) (*User, error)`
- NEVER store in a struct
- `context.WithValue` only for request-scoped data (trace IDs, auth tokens)

### Error Handling
- Always add context: `fmt.Errorf("querying user %s: %w", id, err)`
- `errors.Is()` for sentinels, `errors.As()` for custom types
- Never ignore errors silently. Prefer error over panic for expected failures
- `errors.Join` (1.20+) for combining multiple errors

### Performance
- Never optimize without profiling data. `pprof` first, optimize after
- `go test -bench=. -benchmem` for benchmarks
- `import _ "net/http/pprof"` for production profiling
- Go 1.24: `for b.Loop() { ... }` replaces `for range b.N`

## Hexagonal with Wire DI
Use when your project needs compile-time dependency injection:
```go
// wire.go (build tag: wireinject)
//go:build wireinject

func InitializeApp(cfg *Config) (*App, error) {
    wire.Build(
        NewPostgresPool,    // provides *pgxpool.Pool
        NewUserRepo,        // provides UserRepository
        NewOrderRepo,       // provides OrderRepository
        NewUserService,     // provides *UserService
        NewOrderService,    // provides *OrderService
        NewHTTPHandler,     // provides *Handler
        NewApp,             // provides *App
    )
    return nil, nil
}
```
Wire generates the initialization code at compile time. No runtime reflection.

## DDD in Go
Use when modeling complex business domains with clear invariants:
```go
// Value Object — immutable, compared by value
type Money struct {
    Amount   int64    // cents
    Currency string
}
func (m Money) Add(other Money) (Money, error) {
    if m.Currency != other.Currency { return Money{}, ErrCurrencyMismatch }
    return Money{Amount: m.Amount + other.Amount, Currency: m.Currency}, nil
}

// Aggregate — consistency boundary, owns child entities
type Order struct {
    id    OrderID
    items []OrderItem
    total Money
}
func (o *Order) AddItem(product ProductID, qty int, price Money) error {
    if qty <= 0 { return ErrInvalidQuantity }
    o.items = append(o.items, OrderItem{Product: product, Qty: qty, Price: price})
    o.recalculateTotal()
    return nil
}

// Domain Event — emitted after state change
type OrderPlacedEvent struct {
    OrderID   OrderID
    Total     Money
    Timestamp time.Time
}
```

## Clean Architecture (Uncle Bob adapted)
Use when you need strict dependency rules and testability:
```
internal/
  domain/          <- entities + value objects (zero imports from other layers)
  usecase/         <- application logic, depends only on domain interfaces
  adapter/
    http/           <- HTTP handlers (import usecase interfaces)
    postgres/       <- DB implementations (import domain interfaces)
    grpc/           <- gRPC handlers
  port/            <- interface definitions consumed by usecases
```
Rule: dependencies point inward. Domain knows nothing about HTTP, DB, or gRPC.

## Event-Driven with Channels
Use when decoupling producers and consumers within a single service:
```go
type EventBus struct {
    subscribers map[string][]chan Event
    mu          sync.RWMutex
}

func (b *EventBus) Subscribe(topic string) <-chan Event {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan Event, 64)
    b.subscribers[topic] = append(b.subscribers[topic], ch)
    return ch
}

func (b *EventBus) Publish(ctx context.Context, topic string, event Event) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    for _, ch := range b.subscribers[topic] {
        select {
        case ch <- event:
        case <-ctx.Done(): return
        }
    }
}
```
For cross-service events, use NATS or Watermill instead of in-process channels.
