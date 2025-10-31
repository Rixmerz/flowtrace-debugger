# FlowTrace Go Agent

🚧 **Coming Soon** - This agent is currently under development.

## Planned Features

- Function call tracing via compile-time instrumentation
- Package prefix filtering
- Goroutine tracking
- Framework support: gin, echo, fiber
- JSONL output format compatible with FlowTrace MCP Server

## Architecture Plan

### Approach 1: AST Transformation (Preferred)
Use Go's `ast` package to inject tracing code at compile time:
```go
//go:generate flowtrace instrument

package main

func MyFunction() {
    // Tracing code auto-injected here
}
```

### Approach 2: Build Plugin
Create a custom build plugin that instruments code during compilation.

### Approach 3: eBPF (Advanced)
Use eBPF for kernel-level tracing (requires Linux kernel support).

## Requirements

- Go 1.18+
- No runtime dependencies for core tracing

## Output Format

Compatible with FlowTrace JSONL format:
```json
{"timestamp":1635789012345,"event":"ENTER","goroutine":"1","package":"myapp/services","function":"ProcessData","args":"[1, 2, 3]"}
{"timestamp":1635789012567,"event":"EXIT","goroutine":"1","package":"myapp/services","function":"ProcessData","result":"42","durationMicros":222000,"durationMillis":222}
```

## Contributing

We're actively seeking Go developers to help build this agent!

**Skills needed:**
- Experience with Go AST manipulation (`go/ast`, `go/parser`)
- Understanding of Go build process
- Familiarity with goroutines and concurrency
- Experience with gin, echo, or fiber (optional)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for more information.

## Roadmap

- [ ] AST transformation engine
- [ ] Package prefix filtering
- [ ] Goroutine tracking
- [ ] JSONL log writer
- [ ] Configuration system
- [ ] gin middleware
- [ ] echo middleware
- [ ] fiber middleware
- [ ] CLI tool integration
- [ ] Tests and documentation

## Questions?

Open an issue on GitHub: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger/issues)
