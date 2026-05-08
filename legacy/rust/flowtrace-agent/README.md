# FlowTrace Rust Agent (Prototype)

Function tracing agent for Rust applications.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
flowtrace-agent = { path = "../path/to/flowtrace-agent" }
```

## Usage

### Manual Tracing with Macro

```rust
use flowtrace_agent::{trace_function, Config, start_tracing, stop_tracing};

fn main() {
    // Initialize tracing
    let config = Config::default();
    start_tracing(config).unwrap();

    // Trace a function
    let result = trace_function!("myapp", "calculate", {
        42 * 2
    });

    println!("Result: {}", result);
    stop_tracing();
}
```

### Manual Event Logging

```rust
use flowtrace_agent::{TraceEvent, log_event, Config, start_tracing};

fn main() {
    start_tracing(Config::default()).unwrap();

    let start = std::time::Instant::now();

    log_event(TraceEvent::enter("myapp", "my_function", None));

    // Your function logic
    let result = do_work();

    let duration = start.elapsed().as_secs_f64() * 1000.0;
    log_event(TraceEvent::exit(
        "myapp",
        "my_function",
        Some(format!("{:?}", result)),
        Some(duration),
    ));
}

fn do_work() -> i32 {
    42
}
```

### Configuration

```rust
use flowtrace_agent::Config;

let config = Config {
    package_prefix: "myapp".to_string(),
    log_file: "flowtrace.jsonl".to_string(),
    stdout: false,
    max_arg_length: 1000,
};
```

Or from environment variables:

```bash
export FLOWTRACE_PACKAGE_PREFIX=myapp
export FLOWTRACE_LOGFILE=flowtrace.jsonl
export FLOWTRACE_STDOUT=false
export FLOWTRACE_MAX_ARG_LENGTH=1000
```

```rust
let config = Config::from_env();
```

## Limitations (Prototype)

This is a prototype implementation with manual instrumentation using macros. For automatic instrumentation:

1. **Procedural Macros**: Requires a separate `flowtrace-agent-derive` proc-macro crate
2. **Build Scripts**: Can instrument at build time using `build.rs`
3. **Custom Tooling**: External tools to rewrite source before compilation

## Future Enhancements

- [ ] Procedural macro for `#[trace]` attribute
- [ ] Automatic argument capture and serialization
- [ ] Framework integrations (Actix-web, Rocket, Axum)
- [ ] Async function support with Tokio
- [ ] Performance optimizations (zero-copy, buffering)
- [ ] Filtering and sampling strategies

## Framework Integration (Planned)

### Actix-web Middleware (Future)

```rust
use actix_web::{web, App, HttpServer, middleware};
use flowtrace_agent::actix::FlowTraceMiddleware;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .wrap(FlowTraceMiddleware::default())
            .route("/", web::get().to(index))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
```

### Rocket Integration (Future)

```rust
use rocket::fairing::AdHoc;
use flowtrace_agent::rocket::FlowtraceFairing;

#[launch]
fn rocket() -> _ {
    rocket::build()
        .attach(FlowtraceFairing::default())
        .mount("/", routes![index])
}
```

## Output Format

JSONL format compatible with FlowTrace:

```json
{"type":"ENTER","timestamp":"2025-01-15T10:30:00.123Z","module":"myapp","function":"calculate","args":"[42]","thread_id":"ThreadId(1)"}
{"type":"EXIT","timestamp":"2025-01-15T10:30:00.125Z","module":"myapp","function":"calculate","result":"84","duration":2.5,"thread_id":"ThreadId(1)"}
```

## Development

```bash
# Build
cargo build

# Run tests
cargo test

# Run examples
cargo run --example basic
```

## License

MIT
