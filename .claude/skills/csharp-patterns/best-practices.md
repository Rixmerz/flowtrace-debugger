# C# Best Practices (2024-2025)

## Nullable Reference Types (NRT)
Use when you want compile-time null safety (enable in every new project):
```csharp
// csproj: <Nullable>enable</Nullable>
public class UserService(IUserRepository repo)
{
    public async Task<User?> FindById(string id)  // ? signals nullable return
    {
        ArgumentNullException.ThrowIfNull(id);     // guard non-nullable params
        return await repo.GetById(id);
    }

    public async Task<User> GetOrThrow(string id) =>
        await FindById(id) ?? throw new NotFoundException($"User {id}");
}
```
Rule: enable NRT globally. Use `?` annotations honestly. Never suppress with `!` unless truly required.

## Span<T> and Memory Efficiency
Use when processing data without heap allocations in hot paths:
```csharp
// Parse without allocating substrings
public static (string Key, string Value) ParseHeader(ReadOnlySpan<char> line)
{
    var colonIdx = line.IndexOf(':');
    return (line[..colonIdx].Trim().ToString(), line[(colonIdx + 1)..].Trim().ToString());
}

// Stack-allocated buffer for small data
Span<byte> buffer = stackalloc byte[256];
int bytesRead = stream.Read(buffer);
Process(buffer[..bytesRead]);
```

## ValueTask vs Task
Use `ValueTask` when the result is often available synchronously:
```csharp
// Good: frequently cached, avoids Task allocation
public ValueTask<User> GetUser(string id) =>
    _cache.TryGetValue(id, out var user)
        ? new ValueTask<User>(user)
        : new ValueTask<User>(FetchFromDb(id));

// Bad: always async — just use Task
public async Task<User> CreateUser(CreateUserDto dto) { /* always hits DB */ }
```
Rule: use `Task` by default. Use `ValueTask` only when profiling shows benefit.

## Dependency Injection Patterns
Use the built-in DI container with clear lifetime management:
```csharp
// Registration
builder.Services.AddScoped<IOrderRepository, EfOrderRepository>();
builder.Services.AddSingleton<ICacheService, RedisCacheService>();
builder.Services.AddTransient<IEmailSender, SmtpEmailSender>();

// Primary constructor injection (C# 12)
public class OrderService(
    IOrderRepository orders,
    IPaymentService payments,
    ILogger<OrderService> logger) { }

// Keyed services (.NET 8+)
builder.Services.AddKeyedScoped<INotifier, EmailNotifier>("email");
builder.Services.AddKeyedScoped<INotifier, SmsNotifier>("sms");
```

| Lifetime | Use When |
|----------|----------|
| **Transient** | Lightweight, stateless services |
| **Scoped** | Per-request state (DbContext, UnitOfWork) |
| **Singleton** | Shared state, caches, configuration |

## Configuration (Options Pattern)
Use when binding strongly-typed configuration from appsettings:
```csharp
public class SmtpOptions
{
    public const string Section = "Smtp";
    public required string Host { get; init; }
    public int Port { get; init; } = 587;
    public required string Username { get; init; }
}

// Registration
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.Section));

// Injection
public class EmailSender(IOptions<SmtpOptions> options)
{
    private readonly SmtpOptions _smtp = options.Value;
}
```

## DO / DON'T Quick Reference

| DO | DON'T |
|----|-------|
| Enable `<Nullable>` and `<ImplicitUsings>` | Suppress nullability with `!` everywhere |
| Use `CancellationToken` in all async methods | Use `Task.Result` or `.Wait()` (deadlock risk) |
| Use `record` for DTOs and value objects | Use mutable classes with public setters for data |
| Use primary constructors (C# 12) | Create fields + constructor manually when not needed |
| Use `IAsyncDisposable` for async cleanup | Forget to dispose database connections |
| Use `Span<T>` in parsing hot paths | Allocate strings for intermediate parsing steps |
| Log with `ILogger` + structured messages | Use `Console.WriteLine` for logging |
| Use `TimeProvider` for testable time | Use `DateTime.Now` directly (untestable) |
