# Rust Frameworks & Crates Reference

## Web Backend

| Framework | Stars | Key Trait | When to Use |
|-----------|-------|-----------|-------------|
| **Axum** v0.8 | ~20K | Tokio-native, Tower middleware, type-safe extractors | Default for new projects |
| **Actix-web** v4 | ~23K | 10-15% higher throughput, sub-ms latency | Max raw performance |
| **Rocket** v0.5 | — | Batteries-included (templates, forms, DB) | Full-featured, stable Rust |
| **Warp** v0.4 | — | Functional filter composition | Functional style preference |
| **Salvo** v0.89 | — | HTTP/3 native | Modern protocols |
| **Poem** | — | OpenAPI native | API-first design |

## Frontend & WebAssembly

| Framework | Stars | Key Trait | When to Use |
|-----------|-------|-----------|-------------|
| **Leptos** | ~18.5K | Fine-grained reactivity (SolidJS-style), SSR streaming | Best DX, full-stack Rust |
| **Dioxus** v0.7 | ~20K | Cross-platform (web/desktop/mobile/terminal) | Multi-platform from one codebase |
| **Yew** | ~30.5K | React/Elm model, most popular by stars | Familiar React patterns |

## Async Runtime

| Runtime | Status | When to Use |
|---------|--------|-------------|
| **Tokio** v1.48 | 437M+ downloads, canonical | Default for everything async |
| **smol** | Lightweight | Replacing discontinued async-std |
| **Embassy** | Embedded async | Microcontrollers (STM32, nRF, RP2040) |

`async-std` was **discontinued March 2025**.

## Database

| Crate | Approach | Best For |
|-------|----------|----------|
| **Diesel** v2.3 | Compile-time SQL verification against schema | Type-safe SQL, sync code |
| **SQLx** v0.8 | Async, verification against real DB | Async projects, runtime flexibility |
| **SeaORM** v2.0 | Async ActiveRecord ORM (built on SQLx) | ORM-style, rapid development |

## Serialization

| Crate | Downloads/mo | Best For |
|-------|-------------|----------|
| **Serde** v1.0 | 30M+ | Universal standard |
| **rkyv** | — | Zero-copy deserialization, max performance |

## Networking

- **hyper** v1.x: HTTP foundation
- **reqwest**: HTTP client standard
- **tonic**: gRPC
- **rustls**: Pure-Rust TLS (92% of hyper users)
- **Tower**: Composable middleware framework

## CLI

- **Clap** v4.5: Absolute standard (absorbed structopt)

## Observability

- **tracing** v0.1.41: Instrumentation standard
- **OpenTelemetry**: Logs/Metrics stable, Traces beta

## Testing

- **cargo test**: Built-in unit + integration
- **cargo-nextest**: Parallel execution, better output
- **proptest**: Property-based testing
- **mockall**: Mocking
- **insta**: Snapshot testing
- **criterion**: Benchmarking

## Error Handling

| Crate | Author | When to Use |
|-------|--------|-------------|
| **thiserror** | David Tolnay | Libraries (structured, matchable enums) |
| **anyhow** | David Tolnay | Applications (opaque, contextual errors) |

## Embedded

- **Embassy**: Async framework for microcontrollers (1400+ chips)
- **embedded-hal** 1.0: Hardware abstraction layer (stable)
- **Ferrocene**: ISO 26262 / IEC 61508 certified compiler

## ML/AI

- **Candle** (HuggingFace, ~17K stars): Inference with CUDA/Metal/WASM
- **Burn** (~9K stars): Training + inference, multiple backends

## Caching

- **moka**: Concurrent cache (TinyLFU, similar to Ristretto)
- **cached**: Proc-macro caching for functions
