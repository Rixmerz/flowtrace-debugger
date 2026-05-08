# FlowTrace .NET Agent (Prototype)

Function tracing agent for .NET applications with ASP.NET Core support.

## Installation

Add the package to your project:

```bash
dotnet add reference path/to/Flowtrace.Agent.csproj
```

Or via NuGet (when published):

```bash
dotnet add package Flowtrace.Agent
```

## Usage

### Basic Tracing

```csharp
using Flowtrace.Agent;

class Program
{
    static void Main()
    {
        // Start tracing
        var config = FlowtraceConfig.Default;
        FlowtraceTracer.Start(config);

        try
        {
            MyFunction(42);
        }
        finally
        {
            FlowtraceTracer.Stop();
        }
    }

    static int MyFunction(int value)
    {
        using var tracer = new FunctionTracer("MyApp", "MyFunction", new()
        {
            ["value"] = value
        });

        return value * 2;
    }
}
```

### ASP.NET Core Integration

```csharp
using Flowtrace.Agent;
using Flowtrace.Agent.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

// Initialize Flowtrace
FlowtraceTracer.Start(FlowtraceConfig.Default);

// Add middleware
app.UseFlowtrace();

app.MapGet("/", () => "Hello World!");

app.Run();
```

### Configuration

```csharp
var config = new FlowtraceConfig
{
    PackagePrefix = "MyApp",
    LogFile = "flowtrace.jsonl",
    Stdout = false,
    MaxArgLength = 1000,
    Exclude = new List<string> { "System", "Microsoft" }
};

FlowtraceTracer.Start(config);
```

Or from environment variables:

```bash
export FLOWTRACE_PACKAGE_PREFIX=MyApp
export FLOWTRACE_LOGFILE=flowtrace.jsonl
export FLOWTRACE_STDOUT=false
export FLOWTRACE_MAX_ARG_LENGTH=1000
```

```csharp
var config = FlowtraceConfig.FromEnvironment();
FlowtraceTracer.Start(config);
```

### Manual Event Logging

```csharp
using Flowtrace.Agent;
using System.Diagnostics;

void MyFunction()
{
    var stopwatch = Stopwatch.StartNew();

    FlowtraceTracer.LogEvent(TraceEvent.Enter("MyApp", "MyFunction"));

    try
    {
        // Function logic
        var result = DoWork();

        stopwatch.Stop();
        FlowtraceTracer.LogEvent(TraceEvent.Exit(
            "MyApp",
            "MyFunction",
            result,
            stopwatch.Elapsed.TotalMilliseconds
        ));
    }
    catch (Exception ex)
    {
        stopwatch.Stop();
        FlowtraceTracer.LogEvent(TraceEvent.Exception(
            "MyApp",
            "MyFunction",
            ex.ToString(),
            stopwatch.Elapsed.TotalMilliseconds
        ));
        throw;
    }
}
```

### Async Methods

```csharp
async Task<int> MyAsyncMethod(int value)
{
    using var tracer = new FunctionTracer("MyApp", "MyAsyncMethod", new()
    {
        ["value"] = value
    });

    try
    {
        await Task.Delay(100);
        return value * 2;
    }
    catch (Exception ex)
    {
        tracer.LogException(ex);
        throw;
    }
}
```

## Limitations (Prototype)

This is a prototype implementation with manual instrumentation. For automatic instrumentation:

1. **Source Generators**: Use .NET Source Generators to inject tracing code at compile time
2. **IL Weaving**: Use tools like Fody to inject tracing at IL level
3. **CLR Profiling API**: Use native profiler for runtime instrumentation (advanced)

## Framework Support

- **ASP.NET Core** - Implemented middleware
- **Entity Framework Core** - Planned
- **gRPC** - Planned
- **SignalR** - Planned

## Output Format

JSONL format compatible with FlowTrace:

```json
{"type":"ENTER","timestamp":"2025-01-15T10:30:00.123Z","module":"MyApp","function":"MyFunction","args":{"value":42},"thread_id":"thread-1"}
{"type":"EXIT","timestamp":"2025-01-15T10:30:00.125Z","module":"MyApp","function":"MyFunction","result":84,"duration":2.5,"thread_id":"thread-1"}
```

## Future Enhancements

- [ ] Source Generator for automatic instrumentation
- [ ] Attribute-based tracing (e.g., `[Trace]`)
- [ ] Entity Framework Core interceptor
- [ ] gRPC interceptor
- [ ] SignalR hub filter
- [ ] Performance optimizations (buffering, async logging)
- [ ] Distributed tracing support (OpenTelemetry integration)

## Development

```bash
# Build
dotnet build

# Run tests
dotnet test

# Pack
dotnet pack
```

## Requirements

- .NET 8.0 or later
- ASP.NET Core 8.0 (for middleware)

## License

MIT
