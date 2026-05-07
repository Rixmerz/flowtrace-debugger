using System;
using System.Collections.Generic;
using System.Threading;
using Flowtrace.Agent;

namespace TestPrivate;

// ============================================================================
// User Service
// ============================================================================

public record User(int Id, string Name, string Email);

public partial class UserService
{
    private readonly Dictionary<int, User> _users = new()
    {
        { 42, new User(42, "User42", "user42@example.com") },
        { 999, new User(999, "Invalid", "not-an-email") }
    };

    // PUBLIC method (public)
    [Trace]
    public User LoadUser(int userId)
    {
        Console.WriteLine($"\n[PUBLIC] LoadUser({userId})");

        Sleep(50);
        ValidateUserId(userId);
        return InternalLoad(userId);
    }

    // PUBLIC method (public)
    [Trace]
    public void SaveUser(User user)
    {
        Console.WriteLine($"\n[PUBLIC] SaveUser({user.Name})");

        Sleep(30);

        if (!IsValidEmail(user.Email))
        {
            throw new ArgumentException($"Invalid email: {user.Email}");
        }
    }

    // PRIVATE method
    [Trace]
    private void ValidateUserId(int userId)
    {
        Console.WriteLine($"  [PRIVATE] ValidateUserId({userId})");

        if (userId <= 0)
        {
            throw new ArgumentException($"Invalid user ID: {userId}");
        }
    }

    // PRIVATE method
    [Trace]
    private bool IsValidEmail(string email)
    {
        Console.WriteLine($"  [PRIVATE] IsValidEmail({email})");
        return email.Contains('@') && email.Length > 3;
    }

    // PRIVATE method
    [Trace]
    private User InternalLoad(int userId)
    {
        Console.WriteLine($"  [PRIVATE] InternalLoad({userId})");

        if (!_users.TryGetValue(userId, out var user))
        {
            throw new KeyNotFoundException($"User not found: {userId}");
        }

        return user;
    }

    // INTERNAL method (internal - only accessible within assembly)
    [Trace]
    internal void InternalAudit(int userId)
    {
        Console.WriteLine($"  [INTERNAL] InternalAudit({userId})");
        Console.WriteLine($"    Auditing user {userId}");
    }

    // PROTECTED method (only accessible in derived classes)
    [Trace]
    protected virtual void ProtectedLog(string message)
    {
        Console.WriteLine($"  [PROTECTED] ProtectedLog: {message}");
    }
}

// ============================================================================
// Order Service
// ============================================================================

public record Order(int Id, double Amount, string Status);

public partial class OrderService
{
    // PUBLIC method
    [Trace]
    public Order ProcessOrder(int orderId, double amount)
    {
        Console.WriteLine($"\n[PUBLIC] ProcessOrder({orderId}, {amount:F2})");

        ValidateAmount(amount);
        Sleep(100);

        return new Order(orderId, amount, "COMPLETED");
    }

    // PUBLIC method
    [Trace]
    public void CancelOrder(int orderId)
    {
        Console.WriteLine($"\n[PUBLIC] CancelOrder({orderId})");

        Sleep(30);
        InternalAudit(orderId);
    }

    // PRIVATE method
    [Trace]
    private void ValidateAmount(double amount)
    {
        Console.WriteLine($"  [PRIVATE] ValidateAmount({amount:F2})");

        if (amount <= 0)
        {
            throw new ArgumentException($"Amount must be positive: {amount}");
        }
    }

    // PRIVATE method
    [Trace]
    private void InternalAudit(int orderId)
    {
        Console.WriteLine($"  [PRIVATE] InternalAudit({orderId})");
        Console.WriteLine($"    Auditing order {orderId}");
    }

    // INTERNAL method
    [Trace]
    internal void InternalValidation(int orderId)
    {
        Console.WriteLine($"  [INTERNAL] InternalValidation({orderId})");
    }
}

// ============================================================================
// Helper Class (with private static methods)
// ============================================================================

public static partial class Helper
{
    // PRIVATE static method
    [Trace]
    private static void Sleep(int millis)
    {
        Console.WriteLine($"  [PRIVATE STATIC] Sleep({millis}ms)");
        Thread.Sleep(millis);
    }

    // PUBLIC static method
    [Trace]
    public static string FormatMessage(string message)
    {
        return $"[{DateTime.Now:HH:mm:ss}] {message}";
    }
}

// ============================================================================
// Test Scenarios
// ============================================================================

public partial class TestScenarios
{
    [Trace]
    public static void RunUserScenario()
    {
        Console.WriteLine("\n============================================================");
        Console.WriteLine("SCENARIO 1: User Service - Success Case");
        Console.WriteLine("============================================================");

        var service = new UserService();

        // Test 1: Load user (should call private methods)
        try
        {
            var user = service.LoadUserTraced(42);
            Console.WriteLine($"✅ Loaded user: {user}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }

        // Test 2: Save user (should call private methods)
        var userToSave = new User(42, "User42", "user42@example.com");
        try
        {
            service.SaveUserTraced(userToSave);
            Console.WriteLine($"✅ Saved user: {userToSave.Name}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }

    [Trace]
    public static void RunOrderScenario()
    {
        Console.WriteLine("\n============================================================");
        Console.WriteLine("SCENARIO 2: Order Service");
        Console.WriteLine("============================================================");

        var service = new OrderService();

        // Test 3: Process order (should call ValidateAmount)
        try
        {
            var order = service.ProcessOrderTraced(101, 99.99);
            Console.WriteLine($"✅ Processed order: {order}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }

        // Test 4: Cancel order (should call InternalAudit)
        service.CancelOrderTraced(101);
        Console.WriteLine("✅ Cancelled order 101");
    }

    [Trace]
    public static void RunErrorScenario()
    {
        Console.WriteLine("\n============================================================");
        Console.WriteLine("SCENARIO 3: Error Handling");
        Console.WriteLine("============================================================");

        var service = new UserService();

        // Test 5: Invalid email (should call IsValidEmail and throw)
        var invalidUser = new User(999, "Invalid", "not-an-email");
        try
        {
            service.SaveUserTraced(invalidUser);
            Console.WriteLine("✅ Saved user");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"❌ Expected error: {ex.Message}");
        }

        // Test 6: Invalid user ID (should call ValidateUserId and throw)
        try
        {
            var user = service.LoadUserTraced(-1);
            Console.WriteLine($"✅ Loaded user: {user}");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"❌ Expected error: {ex.Message}");
        }
    }
}

// ============================================================================
// Main Program
// ============================================================================

public partial class Program
{
    public static void Main(string[] args)
    {
        Console.WriteLine("\n============================================================");
        Console.WriteLine("FlowTrace .NET Agent - Private Methods Test");
        Console.WriteLine("============================================================");

        // Configure FlowTrace
        var config = new FlowtraceConfig
        {
            LogFile = "flowtrace-dotnet-private.jsonl",
            WriteToConsole = false
        };

        FlowtraceTracer.Configure(config);

        Console.WriteLine("\n📊 FlowTrace Configuration:");
        Console.WriteLine("  - Log file: flowtrace-dotnet-private.jsonl");
        Console.WriteLine("\n✅ FlowTrace agent started");

        // Run test scenarios
        TestScenarios.RunUserScenarioTraced();
        TestScenarios.RunOrderScenarioTraced();
        TestScenarios.RunErrorScenarioTraced();

        FlowtraceTracer.Shutdown();

        Console.WriteLine("\n============================================================");
        Console.WriteLine("Test Execution Complete");
        Console.WriteLine("============================================================");
        Console.WriteLine("\n📄 Trace logs written to: flowtrace-dotnet-private.jsonl");
        Console.WriteLine("\n💡 Analyze logs:");
        Console.WriteLine("  cat flowtrace-dotnet-private.jsonl | jq .");
        Console.WriteLine("  cat flowtrace-dotnet-private.jsonl | jq -r '.method' | sort | uniq");
    }
}
