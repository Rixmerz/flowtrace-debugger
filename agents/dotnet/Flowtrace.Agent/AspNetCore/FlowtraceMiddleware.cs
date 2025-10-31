using Microsoft.AspNetCore.Http;
using System.Diagnostics;

namespace Flowtrace.Agent.AspNetCore;

/// <summary>
/// ASP.NET Core middleware for tracing HTTP requests with request_id tracking.
/// Logs HTTP_REQUEST and HTTP_RESPONSE events with comprehensive metadata.
/// </summary>
public class FlowtraceMiddleware
{
    private readonly RequestDelegate _next;

    public FlowtraceMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var requestId = Guid.NewGuid().ToString();
        var startTime = DateTime.UtcNow;

        // Log HTTP_REQUEST event
        FlowtraceTracer.LogEvent(new TraceEvent
        {
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Event = "HTTP_REQUEST",
            Thread = Environment.CurrentManagedThreadId.ToString(),
            Metadata = new Dictionary<string, object>
            {
                ["request_id"] = requestId,
                ["method"] = context.Request.Method,
                ["path"] = context.Request.Path.ToString(),
                ["query_string"] = context.Request.QueryString.ToString(),
                ["remote_addr"] = context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                ["user_agent"] = context.Request.Headers["User-Agent"].ToString()
            }
        });

        try
        {
            await _next(context);

            // Log HTTP_RESPONSE event
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            FlowtraceTracer.LogEvent(new TraceEvent
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Event = "HTTP_RESPONSE",
                Thread = Environment.CurrentManagedThreadId.ToString(),
                Metadata = new Dictionary<string, object>
                {
                    ["request_id"] = requestId,
                    ["method"] = context.Request.Method,
                    ["path"] = context.Request.Path.ToString(),
                    ["status_code"] = context.Response.StatusCode,
                    ["duration_millis"] = duration
                }
            });
        }
        catch (Exception ex)
        {
            // Log HTTP_EXCEPTION event
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            FlowtraceTracer.LogEvent(new TraceEvent
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Event = "HTTP_EXCEPTION",
                Thread = Environment.CurrentManagedThreadId.ToString(),
                Metadata = new Dictionary<string, object>
                {
                    ["request_id"] = requestId,
                    ["method"] = context.Request.Method,
                    ["path"] = context.Request.Path.ToString(),
                    ["exception"] = ex.GetType().Name,
                    ["message"] = ex.Message,
                    ["duration_millis"] = duration
                }
            });

            throw;
        }
    }
}

/// <summary>
/// Extension methods for adding Flowtrace middleware
/// </summary>
public static class FlowtraceMiddlewareExtensions
{
    public static IApplicationBuilder UseFlowtrace(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<FlowtraceMiddleware>();
    }
}
