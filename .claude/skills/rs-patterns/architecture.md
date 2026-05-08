# Rust Architecture Patterns

## Hexagonal Architecture (traits as ports)
No DI framework needed — traits + generics provide compile-time polymorphism:

```rust
// Port (trait)
#[async_trait]
trait UserRepository: Send + Sync {
    async fn find_by_id(&self, id: u64) -> Result<User, DomainError>;
    async fn save(&self, user: &User) -> Result<(), DomainError>;
}

// Application service (uses ports generically)
struct UserService<R: UserRepository> { repo: R }

// Production adapter
struct PostgresUserRepo { pool: PgPool }
impl UserRepository for PostgresUserRepo { /* real SQL */ }

// Test adapter — no mocking framework needed
struct MockUserRepo { users: HashMap<u64, User> }
impl UserRepository for MockUserRepo { /* in-memory */ }
```

## Workspace Structure
```
my-project/
  domain/           # Entities, traits (no infra imports)
    src/lib.rs
    Cargo.toml
  application/      # Use cases, depends on domain
  adapters/          # Concrete implementations (DB, HTTP)
  api/               # HTTP/gRPC handlers
  Cargo.toml         # [workspace] with shared deps
```
The compiler enforces layer dependencies.

## Actor Model
- **Actix**: Actor framework (base of Actix-web)
- **kameo**: Distributed actor runtime on Tokio

## CQRS + Event Sourcing
- `cqrs-es`: Aggregates, Commands, Events with read/write separation
- Typed channels for event bus (`tokio::sync::broadcast` for pub/sub, `mpsc` for work queues)

## Microservice Stack
Axum (REST) + Tonic (gRPC) + Tokio + SQLx/Diesel + tracing

## Embedded Architecture
```
PAC (Peripheral Access Crate)    # Auto-generated from SVD
  -> HAL (Hardware Abstraction)  # embedded-hal traits
    -> BSP (Board Support)       # Board-specific config
      -> Application             # Your code
```

Typestate for hardware peripherals:
```rust
// Pin<Input> and Pin<Output> are different types
let pin: Pin<Input<Floating>> = gpio.pa0.into_floating_input();
let pin: Pin<Output<PushPull>> = pin.into_push_pull_output();
// Can't read from Output or write to Input — compile error
```

RAII for interrupt critical sections:
```rust
let _cs = cortex_m::interrupt::free(|cs| {
    // Interrupts disabled in this scope
    // Re-enabled when _cs drops
});
```

## ECS (Entity Component System) — Bevy
```rust
// Components = plain structs
#[derive(Component)]
struct Position { x: f32, y: f32 }

#[derive(Component)]
struct Velocity { dx: f32, dy: f32 }

// Systems = regular functions
fn movement(mut query: Query<(&mut Position, &Velocity)>) {
    for (mut pos, vel) in &mut query {
        pos.x += vel.dx;
        pos.y += vel.dy;
    }
}
// Bevy infers parallelism from data access patterns
```

## Project Organization

### Small project
```
src/
  main.rs      # Thin wrapper
  lib.rs       # All logic (enables testing + library reuse)
```

### Large project (workspace)
```toml
# Cargo.toml
[workspace]
members = ["domain", "application", "adapters", "api"]

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
```
Independent crates with shared dependency versions.
