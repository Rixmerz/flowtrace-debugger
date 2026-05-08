# C# Design Patterns

## Record Types as Value Objects
Use when modeling domain concepts with structural equality:
```csharp
public record Money(decimal Amount, string Currency)
{
    public Money Add(Money other) =>
        Currency == other.Currency
            ? this with { Amount = Amount + other.Amount }
            : throw new CurrencyMismatchException(Currency, other.Currency);
}

// Record struct (stack-allocated, no GC pressure)
public readonly record struct Coordinate(double Lat, double Lon);
```
Records auto-generate `Equals`, `GetHashCode`, `ToString`, deconstruction, and `with` expressions.

## Pattern Matching (Switch Expressions)
Use when branching on type or shape of data:
```csharp
public decimal CalculateDiscount(Customer customer) => customer switch
{
    { Tier: "gold", YearsActive: > 5 } => 0.25m,
    { Tier: "gold" }                    => 0.15m,
    { Tier: "silver" }                  => 0.10m,
    { Orders.Count: > 100 }            => 0.05m,
    _                                   => 0m,
};
```

### List Patterns (C# 11+)
Use when matching on collection structure:
```csharp
var message = args switch
{
    []                    => "No arguments",
    [var single]          => $"One argument: {single}",
    [var first, .., var last] => $"First: {first}, Last: {last}",
};
```

## IDisposable / IAsyncDisposable
Use when managing unmanaged resources (RAII-like cleanup):
```csharp
public class DatabaseConnection : IAsyncDisposable
{
    private readonly NpgsqlConnection _conn;

    public async ValueTask DisposeAsync()
    {
        await _conn.CloseAsync();
        GC.SuppressFinalize(this);
    }
}

// Usage: automatic cleanup with await using
await using var conn = new DatabaseConnection(connString);
await conn.ExecuteAsync(query);
// DisposeAsync called automatically here
```

## Extension Methods as Decorator Pattern
Use when adding behavior without modifying existing types:
```csharp
public static class QueryableExtensions
{
    public static IQueryable<T> WhereIf<T>(
        this IQueryable<T> query, bool condition, Expression<Func<T, bool>> predicate)
        => condition ? query.Where(predicate) : query;

    public static IQueryable<T> Paginate<T>(
        this IQueryable<T> query, int page, int size)
        => query.Skip((page - 1) * size).Take(size);
}

// Usage: chainable, reads naturally
var users = dbContext.Users
    .WhereIf(filter.IsActive.HasValue, u => u.IsActive == filter.IsActive)
    .WhereIf(!string.IsNullOrEmpty(filter.Name), u => u.Name.Contains(filter.Name!))
    .Paginate(page, pageSize);
```

## Source Generators vs Runtime Reflection
Use source generators when you need metadata at compile time without reflection cost:
```csharp
// System.Text.Json source generation (AOT-friendly)
[JsonSerializable(typeof(WeatherForecast))]
[JsonSerializable(typeof(List<WeatherForecast>))]
internal partial class AppJsonContext : JsonSerializerContext { }

// Usage: no reflection, AOT-compatible
var json = JsonSerializer.Serialize(forecast, AppJsonContext.Default.WeatherForecast);
```
Rule: prefer source generators over runtime reflection for serialization, DI, and validation in .NET 8+.

## Result Pattern
Use when you want explicit error handling without exceptions for expected failures:
```csharp
public abstract record Result<T>
{
    public record Ok(T Value) : Result<T>;
    public record Error(string Message) : Result<T>;

    public TOut Match<TOut>(Func<T, TOut> onOk, Func<string, TOut> onError) => this switch
    {
        Ok(var v)    => onOk(v),
        Error(var e) => onError(e),
        _            => throw new InvalidOperationException()
    };
}

// Usage
public Result<User> GetUser(string id) =>
    _repo.FindById(id) is { } user
        ? new Result<User>.Ok(user)
        : new Result<User>.Error($"User {id} not found");
```

## Builder with Required Properties (C# 11+)
Use when constructing complex objects with mandatory and optional fields:
```csharp
public class EmailBuilder
{
    public required string To { get; init; }
    public required string Subject { get; init; }
    public string? Body { get; init; }
    public List<string> Cc { get; init; } = [];
    public Priority Priority { get; init; } = Priority.Normal;

    public Email Build() => new(To, Subject, Body, Cc, Priority);
}

// Usage: compiler enforces required properties
var email = new EmailBuilder
{
    To = "user@example.com",
    Subject = "Hello",
    Cc = ["team@example.com"],
}.Build();
```

## Strategy with Dependency Injection
Use when selecting algorithms at runtime via DI:
```csharp
public interface IShippingCalculator
{
    string Carrier { get; }
    decimal Calculate(Order order);
}

// Register all implementations
services.AddTransient<IShippingCalculator, FedExCalculator>();
services.AddTransient<IShippingCalculator, UpsCalculator>();

// Resolve by name using keyed services (.NET 8+)
services.AddKeyedTransient<IShippingCalculator, FedExCalculator>("fedex");
services.AddKeyedTransient<IShippingCalculator, UpsCalculator>("ups");

// Inject specific implementation
public class OrderService([FromKeyedServices("fedex")] IShippingCalculator calc) { }
```

## Anti-Patterns to Flag

| Anti-Pattern | Fix |
|-------------|-----|
| `async void` methods | Always return `Task` or `ValueTask` |
| Catching `Exception` and swallowing | Catch specific types, log, rethrow or return Result |
| `new` inside methods (tight coupling) | Inject dependencies via constructor |
| String concatenation in loops | Use `StringBuilder` or interpolated string handler |
| `Task.Result` or `.Wait()` (sync-over-async) | Use `await` consistently |
| Mutable DTOs with setters | Use records or `init`-only properties |
| Runtime reflection in hot paths | Use source generators |
| Ignoring `CancellationToken` | Pass and check tokens in all async methods |
