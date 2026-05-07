---
paths: ["**/*.go"]
---

# Go Rules

> Always apply these rules when writing or reviewing Go code.

## DO
- `context.Context` always first parameter
- Add context to errors: `fmt.Errorf("doing X: %w", err)`
- Use `errors.Is()` for sentinels, `errors.As()` for custom types
- `defer cancel()` immediately after creating a context
- `defer mu.Unlock()` immediately after `mu.Lock()`
- Close channels only from sender, exactly once
- Every blocking goroutine must listen to `ctx.Done()`
- Use table-driven tests with `t.Run()`
- Define interfaces at consumer, not provider
- Keep interfaces small (1-3 methods)
- Use functional options for optional configuration
- Design structs so zero value is useful
- Use `internal/` for private packages
- Profile before optimizing (`pprof`)

## DON'T
- Don't store `context.Context` in a struct
- Don't `panic` in library code — return errors
- Don't ignore errors silently
- Don't use `init()` unless absolutely necessary
- Don't use generic package names (`util`, `helpers`, `common`)
- Don't force OOP patterns (deep embedding, getters/setters)
- Don't create interfaces before concrete types exist
- Don't use `gorilla/mux` for new projects (use chi or stdlib 1.22+)
- Don't use `logrus` for new projects (use slog or zerolog)
- Don't start goroutines inside functions without making concurrency explicit to caller
