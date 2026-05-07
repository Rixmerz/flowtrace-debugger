---
paths: ["**/*.rs"]
---

# Rust Rules

> Always apply these rules when writing or reviewing Rust code.

## DO
- Use `?` for error propagation
- Use `thiserror` for library errors, `anyhow` for application errors
- Use `expect("reason")` over `unwrap()` when panic is intentional
- Add `// SAFETY:` comment to every `unsafe` block
- Use iterators (`.iter().map().filter().collect()`) over manual index loops
- Use enums for state modeling with exhaustive `match`
- Use the Newtype pattern for type safety (`struct UserId(u64)`)
- Use Typestate pattern when invalid states should not compile
- Derive `Debug`, `Clone`, `PartialEq` where applicable
- Use `&str` in function params, return `String` when owned
- Use `Cow<str>` when data frequently passes through unmodified
- Put logic in `lib.rs`, keep `main.rs` as thin wrapper
- Use `[workspace.dependencies]` for shared dependency versions
- Run `cargo fmt`, `cargo clippy -D warnings`, `cargo audit` in CI
- Document public APIs with `# Examples`, `# Errors`, `# Panics`
- Use `lto = true` and `codegen-units = 1` in release profile

## DON'T
- Don't use `unwrap()` in production — lacks context
- Don't use `.clone()` reflexively to silence borrow checker — restructure code
- Don't write `unsafe` without documented justification
- Don't use multiple lifetimes on structs when owning data (`String` vs `&str`) works
- Don't ignore compiler warnings or clippy lints
- Don't use `String` params when `&str` suffices (forces caller allocation)
- Don't write C-style index loops — iterators are idiomatic and faster
- Don't use `async-std` — discontinued March 2025, use Tokio or smol
- Don't use `Box<dyn FnMut>` callbacks for observer — use channels
- Don't add `#[inline]` without profiling data
- Don't ignore `cargo audit` results in CI
