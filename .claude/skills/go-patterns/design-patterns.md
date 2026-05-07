# Go Design Patterns

## Functional Options (Rob Pike / Dave Cheney)
```go
type Option func(*Server)
func WithPort(p int) Option { return func(s *Server) { s.port = p } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{host: addr, port: 8080, timeout: 30 * time.Second}
    for _, opt := range opts { opt(s) }
    return s
}
```
Rule: required params are explicit args, optional params are Options.

## Repository Pattern
Interfaces defined at consumer, not provider. Implicit satisfaction:
```go
type UserRepository interface {
    GetByID(ctx context.Context, id string) (*User, error)
    Store(ctx context.Context, user *User) error
}
type postgresUserRepo struct { pool *pgxpool.Pool }
// Satisfies UserRepository implicitly
```

## Error Handling: Three Patterns
```go
// Sentinel errors
var ErrNotFound = errors.New("not found")
if errors.Is(err, ErrNotFound) { /* ... */ }

// Error wrapping (1.13+)
return fmt.Errorf("fetching user %s: %w", id, err)

// Custom error types
type ValidationError struct { Field, Message string }
func (e *ValidationError) Error() string { /* ... */ }
var ve *ValidationError
if errors.As(err, &ve) { /* ... */ }
```

## Composition over Inheritance
```go
type Logger struct { /* ... */ }
func (l *Logger) Log(msg string) { /* ... */ }
type Server struct {
    Logger  // embedding: Server.Log() promoted
    router *http.ServeMux
}
```

## Table-Driven Tests
```go
tests := []struct{ name string; input string; want int; wantErr bool }{
    {"valid", "42.50", 4250, false},
    {"invalid", "abc", 0, true},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) { /* ... */ })
}
```

## Zero Value Design
Design structs so zero value is useful:
- `sync.Mutex` ready to use without initialization
- `bytes.Buffer` is functional as empty buffer
- Avoid constructors when zero value works

## Interface Design
Rob Pike: "The bigger the interface, the weaker the abstraction."
- 1-3 methods preferred
- Compose small interfaces: `type ReadWriter interface { Reader; Writer }`
- Define at consumer, not provider
- Don't create interfaces before concrete types exist

## Anti-Patterns to Flag

| Anti-Pattern | Fix |
|-------------|-----|
| Goroutine leak (blocked without exit) | Listen to `ctx.Done()` in select |
| Hidden `go func()` inside functions | Make concurrency explicit to caller |
| Interface pollution (1 impl "just in case") | Use concrete type, create interface when needed |
| OOP forced in Go (deep embedding, getters/setters) | Simple structs, exported fields |
| Single struct with json+gorm+validate tags | Separate models per concern with mapping functions |
| Generic package names (`util`, `helpers`, `common`) | Descriptive names for what packages DO |
| Error without context (`return err`) | `return fmt.Errorf("operation X: %w", err)` |
| `panic` in library code | Return errors, never panic |
| Forgetting `defer mu.Unlock()` | Always defer immediately after Lock() |
| Barrel imports causing circular deps | Direct imports |

## Result Type with Generics (Go 1.21+)
Use when you need explicit success/error handling without exceptions:
```go
type Result[T any] struct {
    Value T
    Err   error
}

func NewOK[T any](v T) Result[T] { return Result[T]{Value: v} }
func NewErr[T any](err error) Result[T] { return Result[T]{Err: err} }

func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
func (r Result[T]) Map(fn func(T) T) Result[T] {
    if r.Err != nil { return r }
    return NewOK(fn(r.Value))
}
```

## Circuit Breaker
Use when calling unreliable external services to prevent cascade failures:
```go
import "github.com/sony/gobreaker/v2"

cb := gobreaker.NewCircuitBreaker[[]byte](gobreaker.Settings{
    Name:        "external-api",
    MaxRequests: 3,                          // half-open: allow 3 probes
    Interval:    10 * time.Second,           // closed: reset counts every 10s
    Timeout:     30 * time.Second,           // open -> half-open after 30s
    ReadyToTrip: func(c gobreaker.Counts) bool { return c.ConsecutiveFailures > 5 },
})
body, err := cb.Execute(func() ([]byte, error) { return callAPI(ctx) })
```

## Rate Limiter
Use when you need to throttle outgoing requests or protect endpoints:
```go
import "golang.org/x/time/rate"

// 10 requests/second with burst of 30
limiter := rate.NewLimiter(rate.Limit(10), 30)

func handler(w http.ResponseWriter, r *http.Request) {
    if !limiter.Allow() {
        http.Error(w, "rate limited", http.StatusTooManyRequests)
        return
    }
    // process request
}
```

## Generic Repository Pattern
Use when abstracting persistence for multiple entity types:
```go
type Repository[T any, ID comparable] interface {
    GetByID(ctx context.Context, id ID) (*T, error)
    List(ctx context.Context, offset, limit int) ([]T, error)
    Store(ctx context.Context, entity *T) error
    Delete(ctx context.Context, id ID) error
}

type pgRepo[T any, ID comparable] struct {
    pool      *pgxpool.Pool
    tableName string
}
// Implement per-entity with sqlc-generated queries
```

## Middleware Chain
Use when composing HTTP handlers with cross-cutting concerns:
```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        slog.Info("request", "method", r.Method, "path", r.URL.Path, "dur", time.Since(start))
    })
}

// Usage: handler := Chain(myHandler, Logging, Auth, RateLimit)
```
