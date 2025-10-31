using System;

namespace Flowtrace.Agent;

/// <summary>
/// Attribute to mark methods for automatic tracing instrumentation.
/// When applied to a method, the Source Generator will automatically
/// generate tracing code for ENTER, EXIT, and EXCEPTION events.
/// </summary>
/// <example>
/// <code>
/// [Trace]
/// public int Calculate(int x, int y)
/// {
///     return x + y;
/// }
///
/// [Trace]
/// public async Task&lt;string&gt; FetchDataAsync(string url)
/// {
///     // async method support
///     return await client.GetStringAsync(url);
/// }
/// </code>
/// </example>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class TraceAttribute : Attribute
{
    /// <summary>
    /// Optional custom operation name for the trace.
    /// If not specified, the method name will be used.
    /// </summary>
    public string? OperationName { get; set; }

    /// <summary>
    /// Whether to include method arguments in the trace.
    /// Default is true.
    /// </summary>
    public bool IncludeArguments { get; set; } = true;

    /// <summary>
    /// Whether to include the return value in the trace.
    /// Default is true.
    /// </summary>
    public bool IncludeResult { get; set; } = true;
}

/// <summary>
/// Attribute to mark methods that should NOT be traced.
/// This overrides automatic tracing or parent-level trace attributes.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false, Inherited = true)]
public sealed class TraceIgnoreAttribute : Attribute
{
}
