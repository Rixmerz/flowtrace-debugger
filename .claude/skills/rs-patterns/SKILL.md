---
name: rs-patterns
description: Rust architecture reference - frameworks, ownership patterns, async runtime, embedded, and production best practices for 2024-2025. Use when making architectural decisions, reviewing Rust code, or selecting crates.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Rust Architecture Reference (2024-2025)

Comprehensive reference for Rust architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework/crate selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (builder, typestate, newtype, strategy), see [design-patterns.md](design-patterns.md)
- For architecture patterns (hexagonal, actors, CQRS, embedded), see [architecture.md](architecture.md)
- For best practices (error handling, testing, CI, DO/DON'T), see [best-practices.md](best-practices.md)
- For language features (ownership, traits, async, macros, unsafe), see [language-features.md](language-features.md)

## Decision Framework

1. **Web backend**: Default -> Axum. Max throughput -> Actix-web. Batteries-included -> Rocket
2. **Frontend/WASM**: Fine-grained reactivity -> Leptos. Cross-platform -> Dioxus. React-like -> Yew
3. **Async runtime**: Default -> Tokio. Lightweight -> smol. Embedded -> Embassy
4. **Database**: Compile-time SQL -> Diesel. Async + DB verification -> SQLx. ORM-style -> SeaORM
5. **Serialization**: Default -> Serde. Zero-copy perf -> rkyv
6. **Error handling**: Libraries -> thiserror. Applications -> anyhow
7. **CLI**: Always Clap v4.5

## Rust in Production

| Company | Result |
|---------|--------|
| **Cloudflare** (Pingora) | 1T+ req/day, 70% less CPU, 67% less memory vs NGINX |
| **Discord** | ~4x perf vs Go, eliminated GC latency spikes |
| **Google** (Android) | Memory vulns: 76% -> <20%, 223 -> <50 bugs |
| **Microsoft** | 36K lines in Windows kernel, goal: eliminate all C/C++ by 2030 |
| **AWS** (Firecracker) | <125ms boot, <5 MiB memory per microVM |
| **Meta** (Buck2) | 2x faster builds than Buck1 |
| **Figma** | 10x faster serialization vs TypeScript |
| **Linux kernel** | Rust "no longer experimental" (Dec 2025) |

## Rust Evolution

| Version | Key Features |
|---------|-------------|
| 1.75 | Async fn in traits |
| 1.77 | C-string literals (`c"hello"`), `offset_of!` |
| 1.79 | Inline `const` expressions |
| 1.82 | `&raw` pointers, `unsafe extern` blocks |
| 1.85 | **Edition 2024**, async closures, `gen` reserved |
| 1.88 | Let chains (`if let Some(x) = a && cond`) |

Edition 2024: async closures, `unsafe extern` mandatory, Cargo resolver v3, `gen` keyword reserved.

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
