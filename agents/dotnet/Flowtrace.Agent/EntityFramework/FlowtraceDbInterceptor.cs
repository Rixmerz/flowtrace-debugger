using Microsoft.EntityFrameworkCore.Diagnostics;
using System.Data.Common;

namespace Flowtrace.Agent.EntityFramework;

/// <summary>
/// Entity Framework Core interceptor for tracing database operations.
/// Logs DB_QUERY events with SQL, parameters, and execution time.
/// </summary>
public class FlowtraceDbInterceptor : DbCommandInterceptor
{
    public override async ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        LogQuery(command, eventData);
        return await base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override DbDataReader ReaderExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result)
    {
        LogQuery(command, eventData);
        return base.ReaderExecuted(command, eventData, result);
    }

    public override async ValueTask<int> NonQueryExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        LogQuery(command, eventData);
        return await base.NonQueryExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override int NonQueryExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result)
    {
        LogQuery(command, eventData);
        return base.NonQueryExecuted(command, eventData, result);
    }

    public override async ValueTask<object?> ScalarExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        object? result,
        CancellationToken cancellationToken = default)
    {
        LogQuery(command, eventData);
        return await base.ScalarExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override object? ScalarExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        object? result)
    {
        LogQuery(command, eventData);
        return base.ScalarExecuted(command, eventData, result);
    }

    public override void CommandFailed(
        DbCommand command,
        CommandErrorEventData eventData)
    {
        LogQueryError(command, eventData);
        base.CommandFailed(command, eventData);
    }

    public override async Task CommandFailedAsync(
        DbCommand command,
        CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        LogQueryError(command, eventData);
        await base.CommandFailedAsync(command, eventData, cancellationToken);
    }

    private void LogQuery(DbCommand command, CommandExecutedEventData eventData)
    {
        var metadata = new Dictionary<string, object>
        {
            ["sql"] = command.CommandText,
            ["duration_millis"] = eventData.Duration.TotalMilliseconds,
            ["command_type"] = command.CommandType.ToString()
        };

        // Add parameters if any
        if (command.Parameters.Count > 0)
        {
            var parameters = new Dictionary<string, object?>();
            foreach (DbParameter param in command.Parameters)
            {
                parameters[param.ParameterName] = param.Value;
            }
            metadata["parameters"] = parameters;
        }

        FlowtraceTracer.LogEvent(new TraceEvent
        {
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Event = "DB_QUERY",
            Thread = Environment.CurrentManagedThreadId.ToString(),
            Metadata = metadata
        });
    }

    private void LogQueryError(DbCommand command, CommandErrorEventData eventData)
    {
        var metadata = new Dictionary<string, object>
        {
            ["sql"] = command.CommandText,
            ["duration_millis"] = eventData.Duration.TotalMilliseconds,
            ["command_type"] = command.CommandType.ToString(),
            ["exception"] = eventData.Exception.GetType().Name,
            ["message"] = eventData.Exception.Message
        };

        // Add parameters if any
        if (command.Parameters.Count > 0)
        {
            var parameters = new Dictionary<string, object?>();
            foreach (DbParameter param in command.Parameters)
            {
                parameters[param.ParameterName] = param.Value;
            }
            metadata["parameters"] = parameters;
        }

        FlowtraceTracer.LogEvent(new TraceEvent
        {
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Event = "DB_QUERY_ERROR",
            Thread = Environment.CurrentManagedThreadId.ToString(),
            Metadata = metadata
        });
    }
}

/// <summary>
/// Extension methods for adding Flowtrace interceptor to DbContext.
/// </summary>
public static class FlowtraceDbInterceptorExtensions
{
    /// <summary>
    /// Add FlowTrace database interceptor to DbContextOptionsBuilder.
    /// </summary>
    /// <example>
    /// <code>
    /// services.AddDbContext&lt;MyDbContext&gt;(options =>
    ///     options.UseSqlServer(connectionString)
    ///            .AddFlowtrace());
    /// </code>
    /// </example>
    public static DbContextOptionsBuilder AddFlowtrace(this DbContextOptionsBuilder optionsBuilder)
    {
        return optionsBuilder.AddInterceptors(new FlowtraceDbInterceptor());
    }
}
