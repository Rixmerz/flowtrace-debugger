using System.Text.Json;
using Xunit;

namespace Flowtrace.Agent.Tests;

/// <summary>
/// Tests for FlowtraceLogger functionality.
/// </summary>
public class LoggerTests : IDisposable
{
    private readonly string _testLogFile;

    public LoggerTests()
    {
        _testLogFile = Path.Combine(Path.GetTempPath(), $"test_{Guid.NewGuid()}.jsonl");
    }

    public void Dispose()
    {
        if (File.Exists(_testLogFile))
        {
            File.Delete(_testLogFile);
        }
    }

    [Fact]
    public void Logger_WritesEventToFile()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);
        var traceEvent = TraceEvent.Enter("TestClass", "TestMethod", null);

        // Act
        logger.Log(traceEvent);
        logger.Dispose();

        // Assert
        Assert.True(File.Exists(_testLogFile));
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Single(lines);

        var json = JsonDocument.Parse(lines[0]);
        Assert.Equal("ENTER", json.RootElement.GetProperty("event").GetString());
        Assert.Equal("TestClass", json.RootElement.GetProperty("class").GetString());
        Assert.Equal("TestMethod", json.RootElement.GetProperty("function").GetString());
    }

    [Fact]
    public void Logger_WritesMultipleEvents()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);

        // Act
        logger.Log(TraceEvent.Enter("Class1", "Method1", null));
        logger.Log(TraceEvent.Exit("Class1", "Method1", "result", 100));
        logger.Log(TraceEvent.Enter("Class2", "Method2", null));
        logger.Dispose();

        // Assert
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Equal(3, lines.Length);
    }

    [Fact]
    public void Logger_ThreadSafe()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);
        var taskCount = 10;
        var eventsPerTask = 100;

        // Act
        var tasks = Enumerable.Range(0, taskCount).Select(i => Task.Run(() =>
        {
            for (int j = 0; j < eventsPerTask; j++)
            {
                logger.Log(TraceEvent.Enter($"Class{i}", $"Method{j}", null));
            }
        })).ToArray();

        Task.WaitAll(tasks);
        logger.Dispose();

        // Assert
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Equal(taskCount * eventsPerTask, lines.Length);
    }

    [Fact]
    public void Logger_EnterEvent_SerializesCorrectly()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);
        var args = new Dictionary<string, object>
        {
            ["x"] = 5,
            ["y"] = 10
        };

        // Act
        logger.Log(TraceEvent.Enter("Calculator", "Add", args));
        logger.Dispose();

        // Assert
        var line = File.ReadAllLines(_testLogFile)[0];
        var json = JsonDocument.Parse(line);

        Assert.Equal("ENTER", json.RootElement.GetProperty("event").GetString());
        Assert.Equal("Calculator", json.RootElement.GetProperty("class").GetString());
        Assert.Equal("Add", json.RootElement.GetProperty("function").GetString());
        Assert.Contains("\"x\":5", json.RootElement.GetProperty("args").GetString()!);
    }

    [Fact]
    public void Logger_ExitEvent_SerializesCorrectly()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);

        // Act
        logger.Log(TraceEvent.Exit("Calculator", "Add", 15, 1250.5));
        logger.Dispose();

        // Assert
        var line = File.ReadAllLines(_testLogFile)[0];
        var json = JsonDocument.Parse(line);

        Assert.Equal("EXIT", json.RootElement.GetProperty("event").GetString());
        Assert.Equal("Calculator", json.RootElement.GetProperty("class").GetString());
        Assert.Equal("Add", json.RootElement.GetProperty("function").GetString());
        Assert.Equal("15", json.RootElement.GetProperty("result").GetString());
        Assert.True(json.RootElement.GetProperty("durationMillis").GetDouble() > 0);
    }

    [Fact]
    public void Logger_ExceptionEvent_SerializesCorrectly()
    {
        // Arrange
        var logger = new FlowtraceLogger(_testLogFile, writeToConsole: false);

        // Act
        logger.Log(TraceEvent.Exception("Calculator", "Divide", "DivideByZeroException: Cannot divide by zero", 500));
        logger.Dispose();

        // Assert
        var line = File.ReadAllLines(_testLogFile)[0];
        var json = JsonDocument.Parse(line);

        Assert.Equal("EXCEPTION", json.RootElement.GetProperty("event").GetString());
        Assert.Equal("Calculator", json.RootElement.GetProperty("class").GetString());
        Assert.Equal("Divide", json.RootElement.GetProperty("function").GetString());
        Assert.Contains("DivideByZero", json.RootElement.GetProperty("exception").GetString()!);
    }

    [Fact]
    public void Logger_CreatesDirectoryIfNotExists()
    {
        // Arrange
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var logFile = Path.Combine(tempDir, "test.jsonl");

        try
        {
            // Act
            var logger = new FlowtraceLogger(logFile, writeToConsole: false);
            logger.Log(TraceEvent.Enter("Test", "Test", null));
            logger.Dispose();

            // Assert
            Assert.True(Directory.Exists(tempDir));
            Assert.True(File.Exists(logFile));
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, true);
            }
        }
    }
}
