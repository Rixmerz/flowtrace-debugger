# FlowTrace .NET Agent - Simple Example

Simple demonstration of the FlowTrace .NET Agent with Source Generator-based automatic instrumentation.

## Features Demonstrated

- ✅ **[Trace] Attribute**: Compile-time method instrumentation
- ✅ **Sync Methods**: Automatic tracing of synchronous methods
- ✅ **Async Methods**: Full support for async/await with Task<T>
- ✅ **Exception Handling**: Automatic exception event logging
- ✅ **[TraceIgnore]**: Selective exclusion of methods from tracing
- ✅ **JSONL Output**: Events logged to flowtrace.jsonl file

## How It Works

### 1. Mark Methods with [Trace]

```csharp
public partial class Calculator
{
    [Trace]
    public int Add(int x, int y)
    {
        return x + y;
    }

    [Trace]
    public async Task<string> FetchDataAsync(string url)
    {
        await Task.Delay(100);
        return $"Data from {url}";
    }
}
```

### 2. Source Generator Creates Instrumented Versions

At compile-time, the Flowtrace Source Generator automatically creates:

```csharp
public partial class Calculator
{
    public int AddTraced(int x, int y)
    {
        var __flowtrace_stopwatch = System.Diagnostics.Stopwatch.StartNew();

        // Log ENTER event
        FlowtraceTracer.LogEvent(
            TraceEvent.Enter("Calculator", "Add",
                new Dictionary<string, object> { ["x"] = x, ["y"] = y })
        );

        try
        {
            var __flowtrace_result = Add(x, y);

            // Log EXIT event
            __flowtrace_stopwatch.Stop();
            FlowtraceTracer.LogEvent(
                TraceEvent.Exit("Calculator", "Add", __flowtrace_result,
                    __flowtrace_stopwatch.Elapsed.TotalMilliseconds)
            );

            return __flowtrace_result;
        }
        catch (System.Exception __flowtrace_ex)
        {
            // Log EXCEPTION event
            __flowtrace_stopwatch.Stop();
            FlowtraceTracer.LogEvent(
                TraceEvent.Exception("Calculator", "Add",
                    __flowtrace_ex.ToString(),
                    __flowtrace_stopwatch.Elapsed.TotalMilliseconds)
            );
            throw;
        }
    }
}
```

### 3. Call the Instrumented Method

```csharp
var calculator = new Calculator();
var sum = calculator.AddTraced(5, 3);  // Uses instrumented version
```

## Running the Example

```bash
cd examples/SimpleExample
dotnet build
dotnet run
```

## Expected Output

```
FlowTrace .NET Agent - Simple Example
=====================================

Testing synchronous methods:
5 + 3 = 8
4 * 7 = 28
10 / 2 = 5

Testing exception handling:
Caught expected exception: Cannot divide by zero

Testing async method:
Fetched: Data from https://api.example.com

Internal helper result: 10


Trace log written to: flowtrace.jsonl
Check the file to see ENTER, EXIT, and EXCEPTION events!
```

## Trace Output (flowtrace.jsonl)

```json
{"timestamp":1635789012345678,"event":"ENTER","thread":"Main","class":"Calculator","function":"Add","args":"{\"x\":5,\"y\":3}"}
{"timestamp":1635789012567890,"event":"EXIT","thread":"Main","class":"Calculator","function":"Add","result":"8","durationMicros":222212,"durationMillis":222}
{"timestamp":1635789012789012,"event":"ENTER","thread":"Main","class":"Calculator","function":"Multiply","args":"{\"x\":4,\"y\":7}"}
{"timestamp":1635789012890123,"event":"EXIT","thread":"Main","class":"Calculator","function":"Multiply","result":"28","durationMicros":101111,"durationMillis":101}
{"timestamp":1635789013012345,"event":"ENTER","thread":"Main","class":"Calculator","function":"Divide","args":"{\"x\":10,\"y\":0}"}
{"timestamp":1635789013123456,"event":"EXCEPTION","thread":"Main","class":"Calculator","function":"Divide","exception":"System.DivideByZeroException: Cannot divide by zero","durationMicros":111111,"durationMillis":111}
{"timestamp":1635789013234567,"event":"ENTER","thread":"Main","class":"Calculator","function":"FetchDataAsync","args":"{\"url\":\"https://api.example.com\"}"}
{"timestamp":1635789013456789,"event":"EXIT","thread":"Main","class":"Calculator","function":"FetchDataAsync","result":"Data from https://api.example.com","durationMicros":222222,"durationMillis":222}
```

## Key Points

### Source Generator Approach

- **Compile-Time**: Instrumentation happens at build time, zero runtime overhead
- **Type-Safe**: Full IntelliSense and compile-time checking
- **Transparent**: Original methods remain unchanged, instrumented versions are generated
- **Async Support**: Handles both sync and async methods automatically

### Method Naming Convention

- Original method: `Add(int x, int y)`
- Instrumented method: `AddTraced(int x, int y)`
- Call the `Traced` version to enable tracing

### Partial Classes Required

Classes must be marked as `partial` to allow the Source Generator to extend them:

```csharp
public partial class Calculator  // Must be partial
{
    [Trace]
    public int Add(int x, int y) { ... }
}
```

### TraceIgnore Attribute

Use `[TraceIgnore]` to exclude specific methods or entire classes:

```csharp
[TraceIgnore]
public int InternalHelper(int value)
{
    // This will NOT be traced
    return value * 2;
}
```

## Comparison with Other Agents

| Feature | .NET | Python | Go | Rust |
|---------|------|--------|-----|------|
| Instrumentation | Source Generator | Decorator | Comment directive | Proc Macro |
| Timing | Compile-time | Runtime | Compile-time | Compile-time |
| Overhead | Zero runtime | Minimal | Zero runtime | Zero runtime |
| Async Support | ✅ Task<T> | ✅ async/await | ✅ goroutines | ✅ async/await |
| Setup | [Trace] attribute | @trace decorator | //trace comment | #[trace] attribute |

## Next Steps

- See `examples/AspNetCoreAdvanced` for complete REST API example
- See `examples/MinimalApiRealtime` for WebSocket example
- See `examples/Microservice` for production architecture example

## Documentation

- [Main README](../../README.md)
- [Source Generators Guide](../../docs/source-generators.md)
- [API Reference](../../docs/api-reference.md)
