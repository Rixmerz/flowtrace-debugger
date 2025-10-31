using System.Text.Json.Serialization;

namespace Flowtrace.Agent;

/// <summary>
/// Represents a trace event type
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum EventType
{
    ENTER,
    EXIT,
    EXCEPTION
}

/// <summary>
/// Represents a single trace event in the execution flow
/// </summary>
public class TraceEvent
{
    [JsonPropertyName("event")]
    public EventType Event { get; set; }

    [JsonPropertyName("timestamp")]
    public long Timestamp { get; set; }

    [JsonPropertyName("class")]
    public string Class { get; set; } = string.Empty;

    [JsonPropertyName("method")]
    public string Method { get; set; } = string.Empty;

    [JsonPropertyName("args")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Args { get; set; }

    [JsonPropertyName("result")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Result { get; set; }

    [JsonPropertyName("exception")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Exception { get; set; }

    [JsonPropertyName("durationMillis")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? DurationMillis { get; set; }

    [JsonPropertyName("durationMicros")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? DurationMicros { get; set; }

    [JsonPropertyName("thread")]
    public string Thread { get; set; } = string.Empty;

    /// <summary>
    /// Creates an ENTER event
    /// </summary>
    public static TraceEvent Enter(string module, string function, Dictionary<string, object>? args = null)
    {
        var timestampMicros = (DateTime.UtcNow - DateTime.UnixEpoch).Ticks / 10; // Ticks to microseconds
        var argsStr = args != null ? System.Text.Json.JsonSerializer.Serialize(args) : "[]";

        return new TraceEvent
        {
            Event = EventType.ENTER,
            Timestamp = timestampMicros,
            Class = module,
            Method = function,
            Args = argsStr,
            Thread = $"thread-{Environment.CurrentManagedThreadId}"
        };
    }

    /// <summary>
    /// Creates an EXIT event
    /// </summary>
    public static TraceEvent Exit(string module, string function, object? result = null, long? durationMicros = null)
    {
        var timestampMicros = (DateTime.UtcNow - DateTime.UnixEpoch).Ticks / 10; // Ticks to microseconds
        var resultStr = result != null ? result.ToString() : "";
        var durationMillis = durationMicros.HasValue ? durationMicros.Value / 1000 : (long?)null;

        return new TraceEvent
        {
            Event = EventType.EXIT,
            Timestamp = timestampMicros,
            Class = module,
            Method = function,
            Result = resultStr,
            DurationMillis = durationMillis,
            DurationMicros = durationMicros,
            Thread = $"thread-{Environment.CurrentManagedThreadId}"
        };
    }

    /// <summary>
    /// Creates an EXCEPTION event
    /// </summary>
    public static TraceEvent Exception(string module, string function, string exception, long? durationMicros = null)
    {
        var timestampMicros = (DateTime.UtcNow - DateTime.UnixEpoch).Ticks / 10; // Ticks to microseconds
        var durationMillis = durationMicros.HasValue ? durationMicros.Value / 1000 : (long?)null;

        return new TraceEvent
        {
            Event = EventType.EXCEPTION,
            Timestamp = timestampMicros,
            Class = module,
            Method = function,
            Exception = exception,
            DurationMillis = durationMillis,
            DurationMicros = durationMicros,
            Thread = $"thread-{Environment.CurrentManagedThreadId}"
        };
    }
}
