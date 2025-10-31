# Getting Started with FlowTrace Go

A comprehensive guide to get you up and running with FlowTrace in your Go applications.

## Installation

### Using Go Modules (Recommended)

```bash
go get github.com/flowtrace/flowtrace-go
```

### Installing the CLI Tool

```bash
go install github.com/flowtrace/flowtrace-go/cmd/flowctl@latest
```

Verify installation:
```bash
flowctl version
```

## Quick Start

### 1. Basic Tracing

Create a simple traced application:

```go
package main

import (
    "log"
    "github.com/flowtrace/flowtrace-go/flowtrace"
)

func main() {
    // Initialize FlowTrace
    ft := flowtrace.New(flowtrace.Config{
        ServiceName: "my-app",
        OutputFile:  "flowtrace.jsonl",
    })
    defer ft.Close()

    // Trace an operation
    ft.Trace("main_execution", map[string]interface{}{
        "event": "application_start",
    })

    // Your application logic
    processData()
}

func processData() {
    // This will be automatically traced
    log.Println("Processing data...")
}
```

Run your application:
```bash
go run main.go
```

View the trace output:
```bash
cat flowtrace.jsonl
```

### 2. Using the CLI Tool

#### Instrument Existing Code

```bash
# Instrument a single file
flowctl instrument -i main.go -o main_traced.go

# Instrument a package
flowctl instrument -i ./pkg/... -o ./pkg_traced/
```

#### Remove Instrumentation

```bash
# Clean a single file
flowctl clean -i main_traced.go -o main.go

# Clean a package
flowctl clean -i ./pkg_traced/... -o ./pkg/
```

### 3. Framework Integration

#### Gin

```go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/flowtrace/flowtrace-go/flowtrace"
)

func main() {
    ft := flowtrace.New(flowtrace.Config{
        ServiceName: "gin-api",
    })
    defer ft.Close()

    r := gin.Default()

    // Add FlowTrace middleware
    r.Use(flowtrace.GinMiddleware(ft))

    r.GET("/users/:id", getUser)
    r.Run(":8080")
}

func getUser(c *gin.Context) {
    c.JSON(200, gin.H{"user_id": c.Param("id")})
}
```

#### Echo

```go
package main

import (
    "github.com/labstack/echo/v4"
    "github.com/flowtrace/flowtrace-go/flowtrace"
)

func main() {
    ft := flowtrace.New(flowtrace.Config{
        ServiceName: "echo-api",
    })
    defer ft.Close()

    e := echo.New()

    // Add FlowTrace middleware
    e.Use(flowtrace.EchoMiddleware(ft))

    e.GET("/users/:id", getUser)
    e.Start(":8080")
}

func getUser(c echo.Context) error {
    return c.JSON(200, map[string]string{"user_id": c.Param("id")})
}
```

## Configuration

### Environment Variables

```bash
# Service identification
export FLOWTRACE_SERVICE_NAME="my-service"
export FLOWTRACE_SERVICE_VERSION="1.0.0"

# Output configuration
export FLOWTRACE_OUTPUT_FILE="flowtrace.jsonl"
export FLOWTRACE_OUTPUT_STDOUT="false"

# Sampling
export FLOWTRACE_SAMPLE_RATE="1.0"  # 100% sampling

# Run your application
go run main.go
```

### Configuration File

Create `flowtrace.yaml`:

```yaml
service_name: my-service
service_version: 1.0.0
environment: production

output:
  file: flowtrace.jsonl
  stdout: false
  buffer_size: 1000

sampling:
  rate: 1.0
  rules:
    - path: "/health"
      rate: 0.1
    - path: "/metrics"
      rate: 0.0

exclusions:
  packages:
    - "vendor/*"
    - "test/*"
  functions:
    - "init"
    - "main"
```

Load configuration:

```go
ft := flowtrace.NewFromFile("flowtrace.yaml")
defer ft.Close()
```

## Next Steps

- 📖 **[API Reference](./api-reference.md)**: Explore all available functions and types
- ⚙️ **[Configuration Guide](./configuration.md)**: Deep dive into configuration options
- 🔌 **[Framework Integration](./frameworks.md)**: Learn framework-specific integration
- 💡 **[Best Practices](./best-practices.md)**: Tips for optimal usage
- 🛠️ **[Troubleshooting](./troubleshooting.md)**: Common issues and solutions

## Examples

Check out the [examples/](../examples/) directory for complete working examples:

- **basic**: Simple tracing example
- **gin-api**: REST API with Gin
- **echo-api**: REST API with Echo
- **fiber-api**: REST API with Fiber
- **chi-api**: REST API with Chi
- **advanced**: Advanced patterns and techniques

## Support

- 📚 **Documentation**: [docs.flowtrace.io](https://docs.flowtrace.io)
- 🐛 **Issues**: [GitHub Issues](https://github.com/flowtrace/flowtrace-go/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/flowtrace/flowtrace-go/discussions)
