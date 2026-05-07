---
name: csharp-patterns
description: C# architecture reference - frameworks, design patterns, ASP.NET Core, Entity Framework, Blazor, Unity, and production best practices for C# 12/13 and .NET 8/9 (2024-2025). Use when making architectural decisions, reviewing C# code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# C# Architecture Reference (2024-2025)

Comprehensive reference for C# architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework/library selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (records, pattern matching, source generators), see [design-patterns.md](design-patterns.md)
- For architecture patterns (Clean, Vertical Slice, CQRS, microservices), see [architecture.md](architecture.md)
- For best practices (nullable types, Span, DI, configuration), see [best-practices.md](best-practices.md)
- For language features (C# 12/13, .NET 9, AOT), see [language-features.md](language-features.md)

## Decision Framework

1. **Web API**: Minimal APIs (simple, fast) vs Controllers (complex, conventions). Default -> Minimal APIs for new projects
2. **ORM**: Default -> EF Core 9. Performance-critical -> Dapper. Micro-ORM -> RepoDB
3. **Frontend**: Server-rendered -> Blazor Server. SPA -> Blazor WASM. Hybrid -> Blazor Hybrid (MAUI)
4. **Testing**: Default -> xUnit + FluentAssertions. Mocking -> NSubstitute. Integration -> TestContainers
5. **DI**: Default -> Microsoft.Extensions.DI (built-in). Advanced -> Autofac
6. **Messaging**: Default -> MassTransit. Simple -> MediatR (in-process). Cloud -> Azure Service Bus SDK
7. **Mobile/Desktop**: Cross-platform -> MAUI. Game dev -> Unity

## C# in Production

| Company | Result |
|---------|--------|
| **Microsoft** | .NET powers Azure, Visual Studio, Teams, Office backends |
| **Stack Overflow** | ASP.NET Core, serves 100M+ monthly visitors |
| **Unity** | 70%+ of top mobile games use C# scripting |
| **Bing** | Search infrastructure on .NET |
| **GoDaddy** | Migrated from Java to .NET, 40% throughput improvement |
| **UPS** | Package tracking, logistics optimization |
| **Goldman Sachs** | SecDB successor systems |

## C# Evolution

| Version | Key Features |
|---------|-------------|
| C# 10 (.NET 6) | Global usings, file-scoped namespaces, record structs |
| C# 11 (.NET 7) | Raw string literals, list patterns, required members, generic math |
| C# 12 (.NET 8) | Collection expressions, primary constructors, alias any type |
| C# 13 (.NET 9) | `params` collections, `Lock` object, `\e` escape, extension types (preview) |
| C# 14 (.NET 10) | Extension members, field keyword, null-conditional assignment |

LTS releases: .NET 6 (EOL Nov 2024), .NET 8 (EOL Nov 2026). STS: .NET 9 (EOL May 2026).

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
