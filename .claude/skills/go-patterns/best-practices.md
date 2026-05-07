# Go Best Practices (2024-2025)

## Error Handling Idioms
Use `errors.Is` for sentinel comparison, `errors.As` for type extraction:
```go
// Sentinel errors — package-level, unexported when possible
var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")

// Wrapping preserves the chain for Is/As
return fmt.Errorf("fetching user %s: %w", id, err)

// Multi-error (Go 1.20+)
errs := errors.Join(validateName(u.Name), validateEmail(u.Email))
if errs != nil { return errs }

// Custom error with context
type ValidationError struct {
    Field   string
    Message string
}
func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }
```
Rule: always add context when wrapping. Never `return err` without context.

## Testing Patterns

### Table-driven with subtests
```go
tests := []struct {
    name    string
    input   string
    want    int
    wantErr error
}{
    {"valid", "42", 42, nil},
    {"negative", "-1", 0, ErrNegative},
    {"empty", "", 0, ErrEmpty},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Parse(tt.input)
        if !errors.Is(err, tt.wantErr) {
            t.Errorf("Parse(%q) error = %v, want %v", tt.input, err, tt.wantErr)
        }
        if got != tt.want {
            t.Errorf("Parse(%q) = %d, want %d", tt.input, got, tt.want)
        }
    })
}
```

### testify vs stdlib
- **stdlib `testing`**: Zero dependencies, sufficient for most cases
- **testify**: `assert`/`require` for readable assertions, `mock` for interfaces, `suite` for setup/teardown
- **Golden files**: Use `testdata/` directory for expected output comparison

### TestMain for integration setup
```go
func TestMain(m *testing.M) {
    pool := setupPostgres()   // start testcontainer
    code := m.Run()
    pool.Purge()              // cleanup
    os.Exit(code)
}
```

## Project Layout

### Small projects (flat packages)
```
main.go
server.go
handler.go
store.go
```
Use when: <5 files, single responsibility, CLI tools.

### Medium projects
```
cmd/api/main.go
internal/handler/
internal/store/
internal/domain/
```

### Large projects
```
cmd/api/main.go
cmd/worker/main.go
internal/domain/
internal/service/
internal/adapter/http/
internal/adapter/postgres/
pkg/client/          <- public SDK for consumers
```
Rule: start flat, add structure when the code tells you to. Never preemptively create empty directories.

## Module Management

### Workspace mode (Go 1.22+)
Use when developing multiple related modules locally:
```
// go.work
go 1.22
use (
    ./api
    ./shared
    ./worker
)
```

### Replace directives
Use for local development or forked dependencies:
```
// go.mod
replace github.com/broken/lib => ../my-fork
```
Rule: never commit `replace` directives to production. Use workspace mode instead.

## Linting with golangci-lint

### Recommended .golangci.yml
```yaml
linters:
  enable:
    - errcheck       # unchecked errors
    - govet          # suspicious constructs
    - staticcheck    # advanced static analysis
    - unused         # unused code
    - gosimple       # simplifications
    - ineffassign    # unused assignments
    - gocritic       # opinionated but useful checks
    - revive         # configurable linter (replaces golint)
    - errorlint      # errors.Is/As usage
    - noctx          # http requests without context
    - bodyclose      # unclosed response bodies
    - prealloc       # slice preallocation hints

linters-settings:
  gocritic:
    enabled-tags: [diagnostic, style, performance]
  revive:
    rules:
      - name: unexported-return
        disabled: true
```

## DO / DON'T Quick Reference

| DO | DON'T |
|----|-------|
| `ctx` as first param everywhere | Store `context.Context` in structs |
| `defer mu.Unlock()` right after `Lock()` | Forget to unlock on error paths |
| Return errors, add context with `%w` | Use `panic` in library code |
| Use `slog` for structured logging | Use `fmt.Println` for logging |
| Preallocate slices: `make([]T, 0, n)` | Append in loops without capacity hint |
| Close channels from sender only | Close from receiver or close twice |
| Use `golangci-lint` in CI | Rely only on `go vet` |
| Profile before optimizing (`pprof`) | Guess where bottlenecks are |
