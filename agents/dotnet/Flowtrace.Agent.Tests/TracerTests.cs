using Xunit;

namespace Flowtrace.Agent.Tests;

/// <summary>
/// Tests for FlowtraceTracer global tracer.
/// </summary>
public class TracerTests : IDisposable
{
    private readonly string _testLogFile;

    public TracerTests()
    {
        _testLogFile = Path.Combine(Path.GetTempPath(), $"tracer_test_{Guid.NewGuid()}.jsonl");
    }

    public void Dispose()
    {
        FlowtraceTracer.Shutdown();
        if (File.Exists(_testLogFile))
        {
            File.Delete(_testLogFile);
        }
    }

    [Fact]
    public void Tracer_Configure_SetsLogger()
    {
        // Arrange
        var config = new FlowtraceConfig
        {
            LogFile = _testLogFile,
            WriteToConsole = false
        };

        // Act
        FlowtraceTracer.Configure(config);
        FlowtraceTracer.LogEvent(TraceEvent.Enter("Test", "Test", null));
        FlowtraceTracer.Shutdown();

        // Assert
        Assert.True(File.Exists(_testLogFile));
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Single(lines);
    }

    [Fact]
    public void Tracer_LogEvent_WritesToConfiguredLogger()
    {
        // Arrange
        var config = new FlowtraceConfig { LogFile = _testLogFile, WriteToConsole = false };
        FlowtraceTracer.Configure(config);

        // Act
        FlowtraceTracer.LogEvent(TraceEvent.Enter("TestClass", "TestMethod", null));
        FlowtraceTracer.LogEvent(TraceEvent.Exit("TestClass", "TestMethod", "result", 100));
        FlowtraceTracer.Shutdown();

        // Assert
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Equal(2, lines.Length);
    }

    [Fact]
    public void Tracer_Shutdown_FlushesAndClosesLogger()
    {
        // Arrange
        var config = new FlowtraceConfig { LogFile = _testLogFile, WriteToConsole = false };
        FlowtraceTracer.Configure(config);
        FlowtraceTracer.LogEvent(TraceEvent.Enter("Test", "Test", null));

        // Act
        FlowtraceTracer.Shutdown();

        // Assert
        Assert.True(File.Exists(_testLogFile));
        var lines = File.ReadAllLines(_testLogFile);
        Assert.Single(lines);
    }

    [Fact]
    public void Tracer_MultipleConfigures_ReplacesLogger()
    {
        // Arrange
        var config1 = new FlowtraceConfig { LogFile = _testLogFile, WriteToConsole = false };
        var testLogFile2 = Path.Combine(Path.GetTempPath(), $"tracer_test2_{Guid.NewGuid()}.jsonl");

        try
        {
            // Act
            FlowtraceTracer.Configure(config1);
            FlowtraceTracer.LogEvent(TraceEvent.Enter("Test1", "Method1", null));

            var config2 = new FlowtraceConfig { LogFile = testLogFile2, WriteToConsole = false };
            FlowtraceTracer.Configure(config2);
            FlowtraceTracer.LogEvent(TraceEvent.Enter("Test2", "Method2", null));
            FlowtraceTracer.Shutdown();

            // Assert
            Assert.Single(File.ReadAllLines(_testLogFile)); // Only one event
            Assert.Single(File.ReadAllLines(testLogFile2)); // Only one event
        }
        finally
        {
            if (File.Exists(testLogFile2))
            {
                File.Delete(testLogFile2);
            }
        }
    }

    [Fact]
    public void Tracer_BeforeConfigure_DoesNotThrow()
    {
        // Arrange & Act & Assert
        // Should not throw, just won't log anything
        FlowtraceTracer.LogEvent(TraceEvent.Enter("Test", "Test", null));
    }
}
