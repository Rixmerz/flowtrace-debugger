# Go Concurrency Patterns

## Fan-Out/Fan-In
Distribute work across goroutines, merge results into single channel:
```go
func fanIn(ctx context.Context, channels ...<-chan Result) <-chan Result {
    var wg sync.WaitGroup
    merged := make(chan Result)
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for val := range c {
                select {
                case merged <- val:
                case <-ctx.Done(): return
                }
            }
        }(ch)
    }
    go func() { wg.Wait(); close(merged) }()
    return merged
}
```

## Worker Pool
N fixed workers consuming from shared queue:
```go
func processJobs(ctx context.Context, jobs []Job, numWorkers int) <-chan Result {
    jobsCh := make(chan Job)
    results := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobsCh { results <- job.Execute(ctx) }
        }()
    }
    go func() {
        for _, j := range jobs {
            select { case jobsCh <- j: case <-ctx.Done(): break }
        }
        close(jobsCh)
    }()
    go func() { wg.Wait(); close(results) }()
    return results
}
```

## Pipeline
Chained stages, each in its own goroutine:
```go
func generate(ctx context.Context, nums ...int) <-chan int { /* ... */ }
func square(ctx context.Context, in <-chan int) <-chan int { /* ... */ }
// Usage: for val := range square(ctx, generate(ctx, 2, 3, 4)) { ... }
```

## Semaphore (buffered channel)
```go
sem := make(chan struct{}, maxConcurrency)
for _, task := range tasks {
    sem <- struct{}{}
    go func(t Task) { defer func() { <-sem }(); t.Process() }(task)
}
```

## Context Cancellation
Every blocking goroutine MUST listen to `ctx.Done()`:
```go
select {
case <-ctx.Done(): return ctx.Err()
case result <- ch: // work
}
```

## errgroup
Structured concurrency with error propagation:
```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10) // max 10 concurrent goroutines
for _, url := range urls {
    g.Go(func() error { return fetch(ctx, url) })
}
if err := g.Wait(); err != nil { /* first error */ }
```

## Safety Rules

1. Every goroutine that can block MUST listen to `ctx.Done()`
2. Always `defer cancel()` for contexts
3. Close channels only from sender, exactly once
4. Use `sync.WaitGroup` or `errgroup` for completion
5. Detect leaks: `runtime.NumGoroutine()`, pprof, `uber-go/goleak`
6. Prefer worker pools over unlimited goroutine creation
7. Never start goroutines inside functions without making concurrency explicit to caller

## errgroup: Parallel Fetch with Bounded Concurrency
Use when fetching multiple resources in parallel with error short-circuit:
```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(5) // max 5 concurrent fetches

var mu sync.Mutex
results := make(map[string]*Response)

for _, url := range urls {
    g.Go(func() error {
        resp, err := fetch(ctx, url)
        if err != nil { return fmt.Errorf("fetching %s: %w", url, err) }
        mu.Lock()
        results[url] = resp
        mu.Unlock()
        return nil
    })
}
if err := g.Wait(); err != nil { return nil, err }
```

## Generic Fan-In / Fan-Out (Go 1.21+)
Use when distributing work and collecting typed results:
```go
func FanOut[T, R any](ctx context.Context, items []T, workers int, fn func(context.Context, T) (R, error)) ([]R, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(workers)

    results := make([]R, len(items))
    for i, item := range items {
        g.Go(func() error {
            r, err := fn(ctx, item)
            if err != nil { return err }
            results[i] = r // safe: each goroutine writes to unique index
            return nil
        })
    }
    return results, g.Wait()
}
```

## Pipeline with Context Cancellation
Use when processing data through sequential transformation stages:
```go
func generate[T any](ctx context.Context, items ...T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, item := range items {
            select {
            case out <- item:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}

func transform[T, R any](ctx context.Context, in <-chan T, fn func(T) R) <-chan R {
    out := make(chan R)
    go func() {
        defer close(out)
        for val := range in {
            select {
            case out <- fn(val):
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

## Graceful Shutdown
Use when your server needs to drain connections before exiting:
```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080", Handler: mux}
    go func() { srv.ListenAndServe() }()

    <-ctx.Done()
    slog.Info("shutting down...")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(shutdownCtx) // drains in-flight requests
}
```

## Worker Pool with Semaphore Channel
Use when you need bounded concurrency with backpressure:
```go
func ProcessWithPool[T any](ctx context.Context, items []T, maxWorkers int, fn func(context.Context, T) error) error {
    sem := make(chan struct{}, maxWorkers)
    errs := make(chan error, 1) // buffer 1 to avoid goroutine leak

    for _, item := range items {
        select {
        case sem <- struct{}{}: // acquire slot
        case <-ctx.Done(): return ctx.Err()
        }
        go func(it T) {
            defer func() { <-sem }() // release slot
            if err := fn(ctx, it); err != nil {
                select {
                case errs <- err: // report first error
                default:
                }
            }
        }(item)
    }
    // Wait for all workers to finish
    for range maxWorkers { sem <- struct{}{} }

    select {
    case err := <-errs: return err
    default: return nil
    }
}
```
