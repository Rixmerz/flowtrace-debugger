# Rust Design Patterns

## Builder Pattern (most prevalent in Rust)
Three variants due to no default params or function overloading:

### typed-builder (compile-time verification)
```rust
use typed_builder::TypedBuilder;

#[derive(TypedBuilder)]
struct Server {
    host: String,
    port: u16,
    #[builder(default = 100)]
    max_connections: u32,
}
// Omitting host or port = compile error
```

### Manual builder (runtime Result)
```rust
struct ServerBuilder { host: Option<String>, port: Option<u16> }
impl ServerBuilder {
    fn host(mut self, h: impl Into<String>) -> Self { self.host = Some(h.into()); self }
    fn build(self) -> Result<Server, &'static str> {
        Ok(Server { host: self.host.ok_or("host required")?, port: self.port.unwrap_or(8080) })
    }
}
```

## Strategy Pattern: static vs dynamic dispatch
```rust
// Static dispatch (monomorphized, zero-cost, inlineable)
fn process<S: Strategy>(data: &[u8], strategy: &S) -> Vec<u8> { strategy.apply(data) }

// Dynamic dispatch (vtable, heterogeneous collections)
fn process(data: &[u8], strategy: &dyn Strategy) -> Vec<u8> { strategy.apply(data) }
```
Rule: generics for hot paths; trait objects for plugins or runtime-unknown types.

## Observer: channels instead of callbacks
```rust
use tokio::sync::broadcast;

let (tx, _) = broadcast::channel::<Event>(100);
let mut rx = tx.subscribe();

// Publisher
tx.send(Event::OrderPlaced { id: 42 })?;

// Subscriber
tokio::spawn(async move {
    while let Ok(event) = rx.recv().await { handle(event); }
});
```
Avoids borrow checker friction from `Box<dyn FnMut>` callbacks.

## State Pattern: enum vs typestate

### Enum-based (runtime, flexible)
```rust
enum DoorState { Locked, Unlocked, Open }

impl DoorState {
    fn unlock(self) -> Self {
        match self {
            Self::Locked => Self::Unlocked,
            other => other,
        }
    }
}
```

### Typestate (compile-time, zero-cost)
```rust
struct Locked;
struct Unlocked;
struct Door<State> { _state: std::marker::PhantomData<State> }

impl Door<Locked> {
    fn unlock(self) -> Door<Unlocked> { Door { _state: PhantomData } }
}
impl Door<Unlocked> {
    fn open(&self) { /* only available when unlocked */ }
}
// Door<Locked>.open() = compile error
```

## Newtype Pattern (zero-cost type safety)
```rust
struct Meters(f64);
struct Seconds(f64);
struct MetersPerSecond(f64);

impl Meters {
    fn per(self, time: Seconds) -> MetersPerSecond {
        MetersPerSecond(self.0 / time.0)
    }
}
// Can't accidentally mix Meters and Seconds
```

## Interior Mutability
| Type | Thread-safe | Cost | Use Case |
|------|------------|------|----------|
| `Cell<T>` | No | Zero | Copy types, single-threaded |
| `RefCell<T>` | No | Runtime borrow check | Non-Copy, single-threaded |
| `Mutex<T>` | Yes | Lock contention | Multi-threaded exclusive |
| `RwLock<T>` | Yes | Lock contention | Multi-threaded read-heavy |

## Extension Trait Pattern
```rust
// Add methods to external types via blanket impl
trait IteratorExt: Iterator {
    fn take_while_inclusive<P>(self, predicate: P) -> TakeWhileInclusive<Self, P>
    where Self: Sized, P: FnMut(&Self::Item) -> bool;
}
impl<I: Iterator> IteratorExt for I { /* ... */ }
```

## RAII (Resource Acquisition Is Initialization)
`Drop` provides deterministic cleanup. Ownership guarantees resources freed exactly once.
`MutexGuard`, `File`, `Box` are canonical stdlib examples.

## Type-Driven Development
"Parse, don't validate" — invalid data cannot exist in the system:
```rust
struct Email(String);
impl Email {
    fn parse(s: &str) -> Result<Self, ValidationError> {
        if s.contains('@') { Ok(Self(s.to_owned())) }
        else { Err(ValidationError::InvalidEmail) }
    }
}
// Functions taking Email know it's already validated
```
