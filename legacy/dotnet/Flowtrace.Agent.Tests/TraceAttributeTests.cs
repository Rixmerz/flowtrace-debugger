using Xunit;

namespace Flowtrace.Agent.Tests;

/// <summary>
/// Tests for TraceAttribute and TraceIgnoreAttribute.
/// </summary>
public class TraceAttributeTests
{
    [Fact]
    public void TraceAttribute_DefaultValues()
    {
        // Arrange & Act
        var attribute = new TraceAttribute();

        // Assert
        Assert.Null(attribute.OperationName);
        Assert.True(attribute.IncludeArguments);
        Assert.True(attribute.IncludeResult);
    }

    [Fact]
    public void TraceAttribute_CustomOperationName()
    {
        // Arrange & Act
        var attribute = new TraceAttribute
        {
            OperationName = "CustomOperation"
        };

        // Assert
        Assert.Equal("CustomOperation", attribute.OperationName);
    }

    [Fact]
    public void TraceAttribute_IncludeArgumentsFalse()
    {
        // Arrange & Act
        var attribute = new TraceAttribute
        {
            IncludeArguments = false
        };

        // Assert
        Assert.False(attribute.IncludeArguments);
        Assert.True(attribute.IncludeResult); // Other properties unchanged
    }

    [Fact]
    public void TraceAttribute_IncludeResultFalse()
    {
        // Arrange & Act
        var attribute = new TraceAttribute
        {
            IncludeResult = false
        };

        // Assert
        Assert.True(attribute.IncludeArguments); // Other properties unchanged
        Assert.False(attribute.IncludeResult);
    }

    [Fact]
    public void TraceAttribute_AllPropertiesCustom()
    {
        // Arrange & Act
        var attribute = new TraceAttribute
        {
            OperationName = "TestOp",
            IncludeArguments = false,
            IncludeResult = false
        };

        // Assert
        Assert.Equal("TestOp", attribute.OperationName);
        Assert.False(attribute.IncludeArguments);
        Assert.False(attribute.IncludeResult);
    }

    [Fact]
    public void TraceIgnoreAttribute_CanBeCreated()
    {
        // Arrange & Act
        var attribute = new TraceIgnoreAttribute();

        // Assert
        Assert.NotNull(attribute);
    }

    [Fact]
    public void TraceAttribute_CanBeAppliedToMethod()
    {
        // Arrange
        var testClass = new TestClassWithTrace();

        // Act
        var result = testClass.TracedMethod(5);

        // Assert
        Assert.Equal(10, result);
    }

    [Fact]
    public void TraceIgnoreAttribute_CanBeAppliedToMethod()
    {
        // Arrange
        var testClass = new TestClassWithTrace();

        // Act
        var result = testClass.IgnoredMethod(5);

        // Assert
        Assert.Equal(15, result);
    }

    // Test helper class
    private partial class TestClassWithTrace
    {
        [Trace]
        public int TracedMethod(int value)
        {
            return value * 2;
        }

        [TraceIgnore]
        public int IgnoredMethod(int value)
        {
            return value * 3;
        }
    }
}
