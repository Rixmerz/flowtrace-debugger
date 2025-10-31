using System.Diagnostics;

namespace Flowtrace.Agent;

/// <summary>
/// Main tracer for Flowtrace agent
/// </summary>
public static class FlowtraceTracer
{
    private static FlowtraceLogger? _logger;
    private static FlowtraceConfig? _config;

    /// <summary>
    /// Start global tracing
    /// </summary>
    public static void Start(FlowtraceConfig? config = null)
    {
        if (_logger != null)
        {
            throw new InvalidOperationException("Tracer already started");
        }

        _config = config ?? FlowtraceConfig.Default;
        _logger = new FlowtraceLogger(_config);
    }

    /// <summary>
    /// Stop global tracing
    /// </summary>
    public static void Stop()
    {
        _logger?.Dispose();
        _logger = null;
        _config = null;
    }

    /// <summary>
    /// Log a trace event
    /// </summary>
    public static void LogEvent(TraceEvent @event)
    {
        _logger?.Log(@event);
    }

    /// <summary>
    /// Log a trace event asynchronously
    /// </summary>
    public static async Task LogEventAsync(TraceEvent @event)
    {
        if (_logger != null)
        {
            await _logger.LogAsync(@event);
        }
    }
}

/// <summary>
/// Helper class for tracing function execution
/// </summary>
public class FunctionTracer : IDisposable
{
    private readonly string _module;
    private readonly string _function;
    private readonly Stopwatch _stopwatch;
    private bool _disposed;

    public FunctionTracer(string module, string function, Dictionary<string, object>? args = null)
    {
        _module = module;
        _function = function;
        _stopwatch = Stopwatch.StartNew();

        FlowtraceTracer.LogEvent(TraceEvent.Enter(module, function, args));
    }

    public void Dispose()
    {
        if (_disposed) return;

        _stopwatch.Stop();
        var duration = _stopwatch.Elapsed.TotalMilliseconds;

        FlowtraceTracer.LogEvent(TraceEvent.Exit(_module, _function, null, duration));

        _disposed = true;
    }

    /// <summary>
    /// Log exception and dispose
    /// </summary>
    public void LogException(Exception ex)
    {
        if (_disposed) return;

        _stopwatch.Stop();
        var duration = _stopwatch.Elapsed.TotalMilliseconds;

        FlowtraceTracer.LogEvent(TraceEvent.Exception(_module, _function, ex.ToString(), duration));

        _disposed = true;
    }
}
