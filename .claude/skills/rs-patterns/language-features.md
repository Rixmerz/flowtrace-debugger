# Rust Language Features

## Ownership, Borrowing, Lifetimes
- Each value has exactly one owner; value dropped when owner goes out of scope (RAII)
- Assignment = move by default (no GC, no refcounting, zero runtime cost)
- Borrowing: multiple `&T` OR one `&mut T`, never both (prevents data races at compile time)
- Lifetimes (`'a`): annotate how long references live; compiler infers most via elision rules
- NLL (Non-Lexical Lifetimes): borrows end at last use, not end of scope
- Polonius (next-gen borrow checker): will accept more valid programs NLL rejects

## Zero-Cost Abstractions
- Iterators (`.iter().map().filter().collect()`) compile to tight C-equivalent loops
- `Option<&T>` uses null pointer optimization (same size as `&T>`)
- Generics are monomorphized — specialized, inlineable code per instantiation
- Closures without captures compile to function pointers
- `async/await` compiles to state machines, not heap-allocated coroutines

## Traits
- Bounds for static dispatch (monomorphization): `fn f<T: Display>(x: T)`
- `dyn Trait` for dynamic dispatch (vtable): `fn f(x: &dyn Display)`
- Blanket implementations: `impl<T: Display> ToString for T`
- GATs (stable 1.65): associated types with generic params (lending iterators, zero-copy APIs)

## Pattern Matching
Exhaustive matching over enums, structs, tuples, ranges, slices:
```rust
match value {
    Some(0) => "zero",
    Some(n) if n > 0 => "positive",
    Some(_) => "negative",
    None => "nothing",
}
```
Let chains (stable 1.88): `if let Some(x) = a && let Ok(y) = b && cond { ... }`

## Macros
- `macro_rules!`: Declarative, pattern-based
- **Proc macros**: derive, attribute, function-like — full AST manipulation with `syn` + `quote`
- Derive macros power the ecosystem: `#[derive(Serialize, Deserialize, Debug, Clone)]`

## Async/Await
- No built-in runtime — choose Tokio, smol, Embassy
- `async fn` returns a `Future` (state machine)
- `Pin<T>` prevents self-referential futures from moving
- Async closures (`async || {}`) stable in 1.85
- Async fn in traits stable since 1.75

## Unsafe Rust (5 superpowers)
1. Dereference raw pointers
2. Call unsafe functions
3. Access mutable statics
4. Implement unsafe traits
5. Access union fields

Every `unsafe` block must have a `// SAFETY:` comment explaining invariants.
Edition 2024 requires `unsafe extern` blocks.

## Key Trait Implementations
Always derive where applicable:
- `Debug`: Required for error messages and debugging
- `Clone`: When copies are needed
- `PartialEq`/`Eq`: For comparisons
- `Hash`: For use in HashMap/HashSet
- `Display`: For user-facing output
- `Default`: For default construction
- `Send`/`Sync`: Auto-derived, mark thread safety

## Performance Idioms
- `Cow<str>`: Avoids allocation when data passes through unmodified
- `SmallVec`: Stack-allocated for small collections, heap for large
- `&str` in function params instead of `String` (avoids forcing allocation)
- Iterators over manual loops (compiler optimizes better)
- `#[inline]` only after profiling — compiler usually knows best
