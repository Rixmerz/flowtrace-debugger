namespace Flowtrace.Agent;

/// <summary>
/// Configuration for Flowtrace agent
/// </summary>
public class FlowtraceConfig
{
    /// <summary>
    /// Package/namespace prefix for filtering traces
    /// </summary>
    public string PackagePrefix { get; set; } = string.Empty;

    /// <summary>
    /// Path to JSONL log file
    /// </summary>
    public string LogFile { get; set; } = "flowtrace.jsonl";

    /// <summary>
    /// Enable stdout logging
    /// </summary>
    public bool Stdout { get; set; } = false;

    /// <summary>
    /// Maximum length for argument values
    /// </summary>
    public int MaxArgLength { get; set; } = 1000;

    /// <summary>
    /// Namespaces to exclude from tracing
    /// </summary>
    public List<string> Exclude { get; set; } = new();

    /// <summary>
    /// Create configuration from environment variables
    /// </summary>
    public static FlowtraceConfig FromEnvironment()
    {
        return new FlowtraceConfig
        {
            PackagePrefix = Environment.GetEnvironmentVariable("FLOWTRACE_PACKAGE_PREFIX") ?? string.Empty,
            LogFile = Environment.GetEnvironmentVariable("FLOWTRACE_LOGFILE") ?? "flowtrace.jsonl",
            Stdout = Environment.GetEnvironmentVariable("FLOWTRACE_STDOUT") == "true",
            MaxArgLength = int.TryParse(
                Environment.GetEnvironmentVariable("FLOWTRACE_MAX_ARG_LENGTH"),
                out var length
            ) ? length : 1000
        };
    }

    /// <summary>
    /// Default configuration
    /// </summary>
    public static FlowtraceConfig Default => new();
}
