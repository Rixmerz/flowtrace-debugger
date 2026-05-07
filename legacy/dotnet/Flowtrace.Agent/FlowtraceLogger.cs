using System.Text.Json;

namespace Flowtrace.Agent;

/// <summary>
/// Thread-safe JSONL logger for trace events
/// </summary>
public class FlowtraceLogger : IDisposable
{
    private readonly FlowtraceConfig _config;
    private readonly StreamWriter? _fileWriter;
    private readonly SemaphoreSlim _semaphore = new(1, 1);
    private bool _disposed;

    public FlowtraceLogger(FlowtraceConfig config)
    {
        _config = config;

        if (!string.IsNullOrEmpty(config.LogFile))
        {
            _fileWriter = new StreamWriter(config.LogFile, append: true)
            {
                AutoFlush = true
            };
        }
    }

    /// <summary>
    /// Log a trace event
    /// </summary>
    public async Task LogAsync(TraceEvent @event)
    {
        if (_disposed) return;

        await _semaphore.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(@event, new JsonSerializerOptions
            {
                WriteIndented = false
            });

            if (_fileWriter != null)
            {
                await _fileWriter.WriteLineAsync(json);
            }

            if (_config.Stdout)
            {
                Console.WriteLine(json);
            }
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>
    /// Log a trace event synchronously
    /// </summary>
    public void Log(TraceEvent @event)
    {
        LogAsync(@event).GetAwaiter().GetResult();
    }

    public void Dispose()
    {
        if (_disposed) return;

        _semaphore.Wait();
        try
        {
            _fileWriter?.Flush();
            _fileWriter?.Dispose();
            _disposed = true;
        }
        finally
        {
            _semaphore.Release();
            _semaphore.Dispose();
        }

        GC.SuppressFinalize(this);
    }
}
