# FlowTrace .NET/C# Agent

🚧 **Coming Soon** - This agent is currently under development.

## Planned Features

- Method tracing via CLR Profiling API
- Namespace filtering
- Framework support: ASP.NET Core, Entity Framework
- JSONL output format compatible with FlowTrace MCP Server

## Architecture Plan

### CLR Profiling API Approach
Use the .NET Profiling API to instrument methods at runtime via IL rewriting.

### Requirements
- .NET Framework 4.7.2+ or .NET Core 3.1+/.NET 5+
- Windows, Linux, or macOS

## Contributing

We're actively seeking .NET developers to help build this agent!

**Skills needed:**
- Experience with CLR Profiling API
- Understanding of IL (Intermediate Language)
- Familiarity with ASP.NET Core or Entity Framework (optional)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for more information.

## Roadmap

- [ ] CLR Profiler implementation
- [ ] IL rewriting engine
- [ ] Namespace filtering
- [ ] JSONL log writer
- [ ] Configuration system
- [ ] ASP.NET Core middleware
- [ ] Entity Framework interceptors
- [ ] Tests and documentation

## Questions?

Open an issue on GitHub: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger/issues)
