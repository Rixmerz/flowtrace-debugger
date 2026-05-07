using Xunit;

namespace Flowtrace.Agent.Tests;

/// <summary>
/// Tests for FlowtraceConfig configuration class.
/// </summary>
public class ConfigTests
{
    [Fact]
    public void Config_DefaultValues()
    {
        // Arrange & Act
        var config = new FlowtraceConfig();

        // Assert
        Assert.Equal("flowtrace.jsonl", config.LogFile);
        Assert.False(config.WriteToConsole);
    }

    [Fact]
    public void Config_CustomLogFile()
    {
        // Arrange & Act
        var config = new FlowtraceConfig
        {
            LogFile = "custom.jsonl"
        };

        // Assert
        Assert.Equal("custom.jsonl", config.LogFile);
    }

    [Fact]
    public void Config_WriteToConsoleTrue()
    {
        // Arrange & Act
        var config = new FlowtraceConfig
        {
            WriteToConsole = true
        };

        // Assert
        Assert.True(config.WriteToConsole);
    }

    [Fact]
    public void Config_AllPropertiesCustom()
    {
        // Arrange & Act
        var config = new FlowtraceConfig
        {
            LogFile = "test.jsonl",
            WriteToConsole = true
        };

        // Assert
        Assert.Equal("test.jsonl", config.LogFile);
        Assert.True(config.WriteToConsole);
    }

    [Fact]
    public void Config_EmptyLogFileThrows()
    {
        // Arrange & Act & Assert
        Assert.Throws<ArgumentException>(() =>
        {
            var config = new FlowtraceConfig
            {
                LogFile = ""
            };
            FlowtraceTracer.Configure(config);
        });
    }

    [Fact]
    public void Config_NullLogFileThrows()
    {
        // Arrange & Act & Assert
        Assert.Throws<ArgumentNullException>(() =>
        {
            var config = new FlowtraceConfig
            {
                LogFile = null!
            };
            FlowtraceTracer.Configure(config);
        });
    }
}
