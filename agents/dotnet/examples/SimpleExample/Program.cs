using System;
using System.Threading.Tasks;
using Flowtrace.Agent;

namespace SimpleExample;

/// <summary>
/// Simple example demonstrating the [Trace] attribute and Source Generator.
/// The Source Generator will automatically instrument all methods marked with [Trace].
/// </summary>
public partial class Calculator
{
    [Trace]
    public int Add(int x, int y)
    {
        return x + y;
    }

    [Trace]
    public int Multiply(int x, int y)
    {
        return x * y;
    }

    [Trace]
    public double Divide(double x, double y)
    {
        if (y == 0)
        {
            throw new DivideByZeroException("Cannot divide by zero");
        }
        return x / y;
    }

    [Trace]
    public async Task<string> FetchDataAsync(string url)
    {
        // Simulate async operation
        await Task.Delay(100);
        return $"Data from {url}";
    }

    [TraceIgnore]
    public int InternalHelper(int value)
    {
        // This method will NOT be traced
        return value * 2;
    }
}

public partial class Program
{
    public static async Task Main(string[] args)
    {
        // Configure FlowTrace
        var config = new FlowtraceConfig
        {
            LogFile = "flowtrace.jsonl",
            WriteToConsole = true
        };

        FlowtraceTracer.Configure(config);

        Console.WriteLine("FlowTrace .NET Agent - Simple Example");
        Console.WriteLine("=====================================\n");

        var calculator = new Calculator();

        // Test sync methods
        Console.WriteLine("Testing synchronous methods:");
        var sum = calculator.AddTraced(5, 3);
        Console.WriteLine($"5 + 3 = {sum}");

        var product = calculator.MultiplyTraced(4, 7);
        Console.WriteLine($"4 * 7 = {product}");

        // Test division
        try
        {
            var quotient = calculator.DivideTraced(10, 2);
            Console.WriteLine($"10 / 2 = {quotient}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
        }

        // Test exception handling
        Console.WriteLine("\nTesting exception handling:");
        try
        {
            var invalid = calculator.DivideTraced(10, 0);
        }
        catch (DivideByZeroException ex)
        {
            Console.WriteLine($"Caught expected exception: {ex.Message}");
        }

        // Test async method
        Console.WriteLine("\nTesting async method:");
        var data = await calculator.FetchDataAsyncTraced("https://api.example.com");
        Console.WriteLine($"Fetched: {data}");

        // Test ignored method (no tracing)
        var helperResult = calculator.InternalHelper(5);
        Console.WriteLine($"\nInternal helper result: {helperResult}");

        FlowtraceTracer.Shutdown();

        Console.WriteLine("\n\nTrace log written to: flowtrace.jsonl");
        Console.WriteLine("Check the file to see ENTER, EXIT, and EXCEPTION events!");
    }
}
