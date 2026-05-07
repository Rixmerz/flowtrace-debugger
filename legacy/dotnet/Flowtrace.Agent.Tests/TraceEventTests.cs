using Xunit;

namespace Flowtrace.Agent.Tests;

/// <summary>
/// Tests for TraceEvent factory methods and properties.
/// </summary>
public class TraceEventTests
{
    [Fact]
    public void TraceEvent_Enter_CreatesCorrectEvent()
    {
        // Arrange
        var args = new Dictionary<string, object> { ["x"] = 5, ["y"] = 10 };

        // Act
        var traceEvent = TraceEvent.Enter("Calculator", "Add", args);

        // Assert
        Assert.Equal("ENTER", traceEvent.Event);
        Assert.Equal("Calculator", traceEvent.Class);
        Assert.Equal("Add", traceEvent.Function);
        Assert.NotNull(traceEvent.Args);
        Assert.True(traceEvent.Timestamp > 0);
        Assert.NotNull(traceEvent.Thread);
    }

    [Fact]
    public void TraceEvent_Enter_NullArgs()
    {
        // Act
        var traceEvent = TraceEvent.Enter("TestClass", "TestMethod", null);

        // Assert
        Assert.Equal("ENTER", traceEvent.Event);
        Assert.Null(traceEvent.Args);
    }

    [Fact]
    public void TraceEvent_Exit_CreatesCorrectEvent()
    {
        // Act
        var traceEvent = TraceEvent.Exit("Calculator", "Add", 15, 1250.5);

        // Assert
        Assert.Equal("EXIT", traceEvent.Event);
        Assert.Equal("Calculator", traceEvent.Class);
        Assert.Equal("Add", traceEvent.Function);
        Assert.Equal("15", traceEvent.Result);
        Assert.Equal(1250.5, traceEvent.DurationMicros);
        Assert.Equal(1, traceEvent.DurationMillis); // 1250.5 micros = 1.2505 millis = 1 (rounded)
    }

    [Fact]
    public void TraceEvent_Exit_NullResult()
    {
        // Act
        var traceEvent = TraceEvent.Exit("TestClass", "TestMethod", null, 500);

        // Assert
        Assert.Equal("EXIT", traceEvent.Event);
        Assert.Null(traceEvent.Result);
    }

    [Fact]
    public void TraceEvent_Exception_CreatesCorrectEvent()
    {
        // Act
        var traceEvent = TraceEvent.Exception("Calculator", "Divide", "DivideByZeroException: Cannot divide by zero", 750);

        // Assert
        Assert.Equal("EXCEPTION", traceEvent.Event);
        Assert.Equal("Calculator", traceEvent.Class);
        Assert.Equal("Divide", traceEvent.Function);
        Assert.Contains("DivideByZero", traceEvent.ExceptionMessage);
        Assert.Equal(750, traceEvent.DurationMicros);
        Assert.Equal(0, traceEvent.DurationMillis); // 750 micros = 0.75 millis = 0 (rounded)
    }

    [Fact]
    public void TraceEvent_TimestampIsUnixTime()
    {
        // Arrange
        var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Act
        var traceEvent = TraceEvent.Enter("Test", "Test", null);

        // Assert
        var after = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Assert.True(traceEvent.Timestamp >= before);
        Assert.True(traceEvent.Timestamp <= after);
    }

    [Fact]
    public void TraceEvent_ThreadIsCurrentThread()
    {
        // Act
        var traceEvent = TraceEvent.Enter("Test", "Test", null);

        // Assert
        Assert.NotNull(traceEvent.Thread);
        Assert.True(int.TryParse(traceEvent.Thread, out var threadId));
        Assert.True(threadId > 0);
    }

    [Fact]
    public void TraceEvent_DurationConversion()
    {
        // Test various duration conversions
        var testCases = new[]
        {
            (micros: 0.0, expectedMillis: 0),
            (micros: 500.0, expectedMillis: 0),    // 0.5 ms
            (micros: 999.0, expectedMillis: 0),    // 0.999 ms
            (micros: 1000.0, expectedMillis: 1),   // 1 ms
            (micros: 1500.0, expectedMillis: 1),   // 1.5 ms
            (micros: 2500.0, expectedMillis: 2),   // 2.5 ms
            (micros: 10000.0, expectedMillis: 10), // 10 ms
        };

        foreach (var (micros, expectedMillis) in testCases)
        {
            // Act
            var traceEvent = TraceEvent.Exit("Test", "Test", null, micros);

            // Assert
            Assert.Equal(expectedMillis, traceEvent.DurationMillis);
        }
    }

    [Fact]
    public void TraceEvent_ArgsSerializationFormat()
    {
        // Arrange
        var args = new Dictionary<string, object>
        {
            ["name"] = "test",
            ["count"] = 42,
            ["active"] = true
        };

        // Act
        var traceEvent = TraceEvent.Enter("Test", "Test", args);

        // Assert
        Assert.NotNull(traceEvent.Args);
        Assert.Contains("name", traceEvent.Args);
        Assert.Contains("count", traceEvent.Args);
        Assert.Contains("active", traceEvent.Args);
    }
}
