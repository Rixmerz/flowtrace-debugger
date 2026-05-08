# C# Language Features

## C# 12 (.NET 8) — Collection Expressions
Use when initializing collections concisely:
```csharp
// Collection expressions replace verbose constructors
List<int> numbers = [1, 2, 3, 4, 5];
int[] array = [10, 20, 30];
Span<byte> span = [0xFF, 0x00, 0xAA];

// Spread operator
int[] combined = [..firstHalf, ..secondHalf];
List<string> all = [..defaults, ..overrides, "extra"];
```

## C# 12 — Primary Constructors (Classes)
Use when injecting dependencies without explicit field declarations:
```csharp
public class OrderService(IOrderRepository repo, ILogger<OrderService> logger)
{
    public async Task<Order> GetOrder(Guid id)
    {
        logger.LogInformation("Fetching order {Id}", id);
        return await repo.GetById(id) ?? throw new NotFoundException();
    }
}
```
Rule: primary constructor params are captured, not fields. Don't mutate them.

## C# 12 — Alias Any Type
Use when creating readable names for complex types:
```csharp
using Point = (double X, double Y);
using UserMap = System.Collections.Generic.Dictionary<string, User>;

Point origin = (0, 0);
UserMap cache = new();
```

## C# 13 (.NET 9) — params Collections
Use when accepting any collection type as params:
```csharp
public void Log(params ReadOnlySpan<string> messages)
{
    foreach (var msg in messages) Console.WriteLine(msg);
}

// Can pass span, array, list — all work
Log("hello", "world");
Log(["a", "b", "c"]);
```

## C# 13 — Lock Object
Use when you need a lightweight, purpose-built lock:
```csharp
private readonly Lock _lock = new();

public void ThreadSafeUpdate()
{
    lock (_lock)  // compiler uses Lock.EnterScope() — faster than Monitor
    {
        _state.Update();
    }
}
```

## .NET 9 — AOT Improvements
Use when deploying to size-constrained or startup-sensitive environments:
```xml
<PropertyGroup>
    <PublishAot>true</PublishAot>
    <StripSymbols>true</StripSymbols>
</PropertyGroup>
```
- Minimal API + AOT: ~10MB binary, <50ms startup
- Source-generated JSON serialization required (no reflection)
- EF Core 9 partially AOT-compatible
- Trimming warnings guide: resolve all `IL2XXX` warnings for correctness

## .NET 9 — Built-in JSON Improvements
Use when serializing/deserializing with System.Text.Json:
```csharp
// JSON schema generation
var schema = JsonSchemaExporter.GetJsonSchemaAsNode(
    JsonSerializerOptions.Default, typeof<WeatherForecast>());

// Customizing indentation
var options = new JsonSerializerOptions
{
    WriteIndented = true,
    IndentCharacter = '\t',
    IndentSize = 1,
};
```

## Pattern Matching Evolution

| Version | Feature | Example |
|---------|---------|---------|
| C# 9 | Relational | `x is > 0 and < 100` |
| C# 9 | Logical | `x is not null` |
| C# 10 | Extended property | `obj is { Nested.Prop: "value" }` |
| C# 11 | List patterns | `arr is [1, .., > 5]` |
| C# 11 | Slice | `span is [var first, .. var rest]` |
| C# 12 | With collection expr | `[..a, ..b]` in switch |

## Async/Await Patterns
```csharp
// Parallel execution with WhenAll
var (user, orders) = await (GetUserAsync(id), GetOrdersAsync(id)).Await();

// Extension for tuple await
public static async Task<(T1, T2)> Await<T1, T2>(this (Task<T1>, Task<T2>) tasks)
{
    await Task.WhenAll(tasks.Item1, tasks.Item2);
    return (tasks.Item1.Result, tasks.Item2.Result);
}

// IAsyncEnumerable for streaming
await foreach (var item in GetItemsAsync(ct))
{
    yield return Transform(item);
}
```
