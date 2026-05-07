# FlowTrace Go Agent Documentation

Complete documentation for the FlowTrace Go agent and `flowctl` CLI tool.

## 📚 Table of Contents

- [Getting Started](./getting-started.md)
- [API Reference](./api-reference.md)
- [Configuration Guide](./configuration.md)
- [Framework Integration](./frameworks.md)
- [Best Practices](./best-practices.md)
- [Troubleshooting](./troubleshooting.md)

## Quick Links

### Installation
```bash
go get github.com/flowtrace/flowtrace-go
```

### Basic Usage
```go
import "github.com/flowtrace/flowtrace-go/flowtrace"

func main() {
    ft := flowtrace.New(flowtrace.Config{
        ServiceName: "my-service",
        OutputFile:  "flowtrace.jsonl",
    })
    defer ft.Close()

    ft.Trace("operation", map[string]interface{}{
        "user_id": 123,
    })
}
```

### CLI Tool
```bash
# Instrument your code
flowctl instrument -i main.go -o main_traced.go

# Remove instrumentation
flowctl clean -i main_traced.go -o main.go
```

## Documentation Structure

### For Users
- **Getting Started**: Installation, first steps, basic examples
- **Configuration Guide**: All configuration options and environment variables
- **Framework Integration**: Gin, Echo, Fiber, Chi integration guides

### For Developers
- **API Reference**: Complete API documentation with examples
- **Best Practices**: Performance tips, patterns, anti-patterns
- **Troubleshooting**: Common issues and solutions

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to this documentation.

## Support

- GitHub Issues: [flowtrace/issues](https://github.com/flowtrace/flowtrace-go/issues)
- Documentation: [docs.flowtrace.io](https://docs.flowtrace.io)
- Examples: [examples/](../examples/)
