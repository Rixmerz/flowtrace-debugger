# API Reference

Complete API documentation for FlowTrace Go.

## Package: flowtrace

### Types

#### Config

Configuration for FlowTrace instance.

```go
type Config struct {
    // Service identification
    ServiceName    string `json:"service_name" yaml:"service_name"`
    ServiceVersion string `json:"service_version" yaml:"service_version"`
    Environment    string `json:"environment" yaml:"environment"`

    // Output configuration
    OutputFile   string `json:"output_file" yaml:"output_file"`
    OutputStdout bool   `json:"output_stdout" yaml:"output_stdout"`
    BufferSize   int    `json:"buffer_size" yaml:"buffer_size"`

    // Sampling configuration
    SampleRate float64        `json:"sample_rate" yaml:"sample_rate"`
    Rules      []SamplingRule `json:"rules" yaml:"rules"`

    // Exclusion configuration
    Exclusions Exclusions `json:"exclusions" yaml:"exclusions"`
}
```

**Fields:**
- `ServiceName`: Identifier for your service (required)
- `ServiceVersion`: Version of your service
- `Environment`: Environment name (dev, staging, production)
- `OutputFile`: Path to output JSONL file
- `OutputStdout`: Write traces to stdout
- `BufferSize`: Number of traces to buffer before flush (default: 100)
- `SampleRate`: Sampling rate 0.0-1.0 (default: 1.0)
- `Rules`: Path-specific sampling rules
- `Exclusions`: Package/function exclusion rules

#### SamplingRule

Rule for path-specific sampling.

```go
type SamplingRule struct {
    Path string  `json:"path" yaml:"path"`
    Rate float64 `json:"rate" yaml:"rate"`
}
```

**Example:**
```go
rules := []flowtrace.SamplingRule{
    {Path: "/health", Rate: 0.1},   // Sample 10% of health checks
    {Path: "/metrics", Rate: 0.0},  // Don't sample metrics
}
```

#### Exclusions

Package and function exclusion configuration.

```go
type Exclusions struct {
    Packages  []string `json:"packages" yaml:"packages"`
    Functions []string `json:"functions" yaml:"functions"`
}
```

**Example:**
```go
exclusions := flowtrace.Exclusions{
    Packages:  []string{"vendor/*", "test/*"},
    Functions: []string{"init", "main"},
}
```

### Functions

#### New

Creates a new FlowTrace instance with configuration.

```go
func New(config Config) *FlowTrace
```

**Example:**
```go
ft := flowtrace.New(flowtrace.Config{
    ServiceName: "my-service",
    OutputFile:  "flowtrace.jsonl",
    SampleRate:  1.0,
})
defer ft.Close()
```

#### NewFromFile

Creates a FlowTrace instance from configuration file.

```go
func NewFromFile(filepath string) (*FlowTrace, error)
```

**Supported formats:** YAML, JSON

**Example:**
```go
ft, err := flowtrace.NewFromFile("flowtrace.yaml")
if err != nil {
    log.Fatal(err)
}
defer ft.Close()
```

#### NewFromEnv

Creates a FlowTrace instance from environment variables.

```go
func NewFromEnv() *FlowTrace
```

**Environment variables:**
- `FLOWTRACE_SERVICE_NAME`
- `FLOWTRACE_SERVICE_VERSION`
- `FLOWTRACE_ENVIRONMENT`
- `FLOWTRACE_OUTPUT_FILE`
- `FLOWTRACE_OUTPUT_STDOUT`
- `FLOWTRACE_SAMPLE_RATE`

**Example:**
```bash
export FLOWTRACE_SERVICE_NAME="my-service"
export FLOWTRACE_OUTPUT_FILE="flowtrace.jsonl"
```

```go
ft := flowtrace.NewFromEnv()
defer ft.Close()
```

### Methods

#### Trace

Records a trace event with metadata.

```go
func (ft *FlowTrace) Trace(operation string, metadata map[string]interface{})
```

**Parameters:**
- `operation`: Name of the operation being traced
- `metadata`: Additional context data

**Example:**
```go
ft.Trace("user_login", map[string]interface{}{
    "user_id": 123,
    "ip":      "192.168.1.1",
    "success": true,
})
```

#### TraceWithContext

Records a trace event with Go context.

```go
func (ft *FlowTrace) TraceWithContext(
    ctx context.Context,
    operation string,
    metadata map[string]interface{},
)
```

**Example:**
```go
ctx := context.Background()
ft.TraceWithContext(ctx, "database_query", map[string]interface{}{
    "query": "SELECT * FROM users",
    "duration_ms": 45,
})
```

#### StartSpan

Begins a new trace span.

```go
func (ft *FlowTrace) StartSpan(operation string) *Span
```

**Example:**
```go
span := ft.StartSpan("complex_operation")
defer span.End()

// Do work...
span.SetTag("items_processed", 100)
```

#### Close

Flushes buffered traces and closes output.

```go
func (ft *FlowTrace) Close() error
```

**Example:**
```go
defer ft.Close()
```

## Package: flowtrace/middleware

### Gin Middleware

#### GinMiddleware

Creates Gin middleware for automatic request tracing.

```go
func GinMiddleware(ft *flowtrace.FlowTrace) gin.HandlerFunc
```

**Example:**
```go
r := gin.Default()
r.Use(flowtrace.GinMiddleware(ft))
```

**Traced data:**
- Request method, path, headers
- Response status code, size
- Request duration
- Client IP, User-Agent

### Echo Middleware

#### EchoMiddleware

Creates Echo middleware for automatic request tracing.

```go
func EchoMiddleware(ft *flowtrace.FlowTrace) echo.MiddlewareFunc
```

**Example:**
```go
e := echo.New()
e.Use(flowtrace.EchoMiddleware(ft))
```

### Fiber Middleware

#### FiberMiddleware

Creates Fiber middleware for automatic request tracing.

```go
func FiberMiddleware(ft *flowtrace.FlowTrace) fiber.Handler
```

**Example:**
```go
app := fiber.New()
app.Use(flowtrace.FiberMiddleware(ft))
```

### Chi Middleware

#### ChiMiddleware

Creates Chi middleware for automatic request tracing.

```go
func ChiMiddleware(ft *flowtrace.FlowTrace) func(http.Handler) http.Handler
```

**Example:**
```go
r := chi.NewRouter()
r.Use(flowtrace.ChiMiddleware(ft))
```

## Package: flowtrace/span

### Span

Represents a trace span for timing operations.

```go
type Span struct {
    Operation string
    StartTime time.Time
    EndTime   time.Time
    Tags      map[string]interface{}
}
```

### Methods

#### SetTag

Adds metadata to the span.

```go
func (s *Span) SetTag(key string, value interface{})
```

**Example:**
```go
span.SetTag("user_id", 123)
span.SetTag("cache_hit", true)
```

#### SetError

Marks the span as errored.

```go
func (s *Span) SetError(err error)
```

**Example:**
```go
if err := doWork(); err != nil {
    span.SetError(err)
    return err
}
```

#### End

Completes the span and records it.

```go
func (s *Span) End()
```

**Example:**
```go
span := ft.StartSpan("database_query")
defer span.End()
```

## CLI Tool: flowctl

### Commands

#### instrument

Adds FlowTrace instrumentation to Go source code.

```bash
flowctl instrument [flags]
```

**Flags:**
- `-i, --input`: Input file or package path (required)
- `-o, --output`: Output file or directory (required)
- `-c, --config`: Configuration file path
- `--dry-run`: Show changes without writing files
- `--verbose`: Verbose output

**Examples:**
```bash
# Instrument a single file
flowctl instrument -i main.go -o main_traced.go

# Instrument a package
flowctl instrument -i ./pkg -o ./pkg_traced

# Dry run with config
flowctl instrument -i main.go -o main_traced.go -c flowtrace.yaml --dry-run
```

#### clean

Removes FlowTrace instrumentation from Go source code.

```bash
flowctl clean [flags]
```

**Flags:**
- `-i, --input`: Input file or package path (required)
- `-o, --output`: Output file or directory (required)
- `--dry-run`: Show changes without writing files
- `--verbose`: Verbose output

**Examples:**
```bash
# Clean a single file
flowctl clean -i main_traced.go -o main.go

# Clean a package
flowctl clean -i ./pkg_traced -o ./pkg

# Dry run
flowctl clean -i main_traced.go -o main.go --dry-run
```

#### validate

Validates FlowTrace configuration file.

```bash
flowctl validate [flags]
```

**Flags:**
- `-c, --config`: Configuration file path (required)

**Example:**
```bash
flowctl validate -c flowtrace.yaml
```

#### version

Shows FlowTrace version information.

```bash
flowctl version
```

## Error Handling

### Common Errors

#### ErrInvalidConfig

Configuration validation failed.

```go
if err != nil && errors.Is(err, flowtrace.ErrInvalidConfig) {
    log.Fatal("Invalid configuration:", err)
}
```

#### ErrOutputFailed

Failed to write trace output.

```go
if err != nil && errors.Is(err, flowtrace.ErrOutputFailed) {
    log.Error("Output error:", err)
}
```

## Performance Considerations

### Buffering

```go
ft := flowtrace.New(flowtrace.Config{
    ServiceName: "my-service",
    BufferSize:  1000,  // Buffer 1000 traces before flush
})
```

**Recommendations:**
- High-throughput services: 1000-5000
- Low-latency services: 100-500
- Default: 100

### Sampling

```go
ft := flowtrace.New(flowtrace.Config{
    ServiceName: "my-service",
    SampleRate:  0.1,  // Sample 10% of requests
})
```

**Recommendations:**
- Development: 1.0 (100%)
- Production high-traffic: 0.01-0.1 (1-10%)
- Production low-traffic: 0.5-1.0 (50-100%)

## Next Steps

- 📖 [Configuration Guide](./configuration.md)
- 🔌 [Framework Integration](./frameworks.md)
- 💡 [Best Practices](./best-practices.md)
- 🛠️ [Troubleshooting](./troubleshooting.md)
