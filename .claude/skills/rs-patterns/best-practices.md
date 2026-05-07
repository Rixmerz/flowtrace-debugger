# Rust Best Practices (2024-2025)

## Error Handling: thiserror + anyhow
```rust
// Library: structured errors with thiserror
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read config: {path}")]
    ReadFile { path: String, #[source] source: std::io::Error },
    #[error("invalid format")]
    InvalidFormat(#[from] serde_json::Error),
}

// Application: contextual errors with anyhow
fn load_config(path: &str) -> anyhow::Result<Config> {
    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path))?;
    Ok(serde_json::from_str(&contents)?)
}
```

## Testing Strategy
```rust
// Unit tests inline
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_valid() { assert_eq!(parse("42"), Ok(42)); }
}

// Property-based testing with proptest
proptest! {
    #[test]
    fn roundtrip_encode_decode(s in "\\PC*") {
        let encoded = encode(&s);
        let decoded = decode(&encoded)?;
        prop_assert_eq!(s, decoded);
    }
}

// Snapshot testing with insta
#[test]
fn test_output_format() {
    insta::assert_snapshot!(render_report(&data));
}
```

Use **cargo-nextest** for parallel execution.

## CI Pipeline (minimum)
```yaml
- run: cargo fmt -- --check
- run: cargo clippy --all-targets -- -D warnings
- run: cargo test --all-features
- run: cargo install cargo-audit && cargo audit
```

Add **cargo-deny** for license/duplicate checks. **Miri** for unsafe UB detection.

## Release Profile
```toml
[profile.release]
lto = true              # Link-time optimization
codegen-units = 1        # Max optimization
strip = true             # Smaller binary
overflow-checks = true   # Keep for safety in production
```

## Dependency Management
- Use `[workspace.dependencies]` for shared versions
- `cargo audit` in CI for vulnerability scanning
- `cargo deny` for license compliance
- Trusted Publishing on crates.io (OIDC, no API tokens)

## Documentation
Document all public APIs with:
- `# Examples` (executable doc tests)
- `# Errors` (when Result is returned)
- `# Panics` (if function can panic)
