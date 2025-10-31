# FlowTrace Rust Agent

🚧 **Coming Soon** - This agent is currently under development.

## Planned Features

- Function tracing via procedural macros (`#[trace]`)
- Crate filtering
- Zero-cost abstractions
- Framework support: actix-web, rocket, axum
- JSONL output format compatible with FlowTrace MCP Server

## Architecture Plan

### Procedural Macro Approach
```rust
use flowtrace::trace;

#[trace]
fn my_function(x: i32) -> i32 {
    x * 2
}
```

The macro will expand to:
```rust
fn my_function(x: i32) -> i32 {
    flowtrace::enter("my_function", &[&x]);
    let result = x * 2;
    flowtrace::exit("my_function", &result);
    result
}
```

## Requirements

- Rust 1.70+
- No runtime dependencies for core tracing

## Contributing

We're actively seeking Rust developers to help build this agent!

**Skills needed:**
- Experience with Rust procedural macros
- Understanding of `syn`, `quote`, and `proc-macro2`
- Familiarity with actix-web, rocket, or axum (optional)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for more information.

## Roadmap

- [ ] Procedural macro implementation
- [ ] Crate filtering
- [ ] JSONL log writer
- [ ] Configuration system
- [ ] actix-web middleware
- [ ] rocket fairing
- [ ] axum middleware
- [ ] Async support
- [ ] Tests and documentation

## Questions?

Open an issue on GitHub: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger/issues)
