# C# Frameworks & Libraries

## Web Frameworks

| Framework | Use Case | Key Feature |
|-----------|----------|-------------|
| **ASP.NET Core Minimal APIs** | REST APIs, microservices | Minimal boilerplate, AOT-friendly |
| **ASP.NET Core Controllers** | Complex APIs, MVC pattern | Conventions, filters, model binding |
| **Blazor Server** | Server-rendered interactive UI | Real-time via SignalR, no WASM download |
| **Blazor WASM** | Client-side SPA | Runs in browser, offline capable |
| **Blazor Hybrid** | Desktop/mobile with web UI | MAUI + Blazor, native access |

## ORM / Data Access

| Library | Best For | Trade-off |
|---------|----------|-----------|
| **EF Core 9** | Default ORM, LINQ queries | Full-featured, heavier |
| **Dapper** | Performance-critical SQL | Raw SQL, manual mapping |
| **RepoDB** | Micro-ORM with ORM features | Good middle ground |
| **LINQ to DB** | Type-safe SQL generation | Thin, close to SQL |

## Testing

| Tool | Purpose |
|------|---------|
| **xUnit** | Default test framework (.NET team uses it) |
| **NUnit** | Alternative with more assertions built-in |
| **FluentAssertions** | Readable assertion syntax |
| **NSubstitute** | Mocking (simpler than Moq) |
| **Bogus** | Realistic test data generation |
| **TestContainers** | Integration tests with Docker |
| **Verify** | Snapshot/approval testing |

## Messaging / CQRS

| Library | Best For |
|---------|----------|
| **MediatR** | In-process CQRS, pipeline behaviors |
| **MassTransit** | Distributed messaging (RabbitMQ, Azure SB, Kafka) |
| **Wolverine** | MediatR alternative with built-in persistence |
| **Rebus** | Simple message bus |

## Mobile / Desktop / Game

| Framework | Platform | Note |
|-----------|----------|------|
| **.NET MAUI** | iOS, Android, Windows, macOS | Successor to Xamarin.Forms |
| **Avalonia UI** | Cross-platform desktop (incl. Linux) | WPF-like, MVVM |
| **Unity** | Games (2D/3D, mobile, console, VR) | C# scripting, 70%+ mobile games |
| **Godot (C#)** | Open-source game engine | .NET 8 support |

## Observability

| Tool | Purpose |
|------|---------|
| **OpenTelemetry .NET** | Distributed tracing, metrics |
| **Serilog** | Structured logging (sinks for any target) |
| **Polly** | Resilience (retry, circuit breaker, timeout) |
| **HealthChecks** | Built-in health check middleware |
