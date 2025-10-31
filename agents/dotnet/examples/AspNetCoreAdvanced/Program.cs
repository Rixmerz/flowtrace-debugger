using System.Collections.Concurrent;
using System.Text.Json;
using Flowtrace.Agent;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

// Configure FlowTrace
var flowtraceConfig = new FlowtraceConfig
{
    LogFile = "flowtrace.jsonl",
    WriteToConsole = true
};
FlowtraceTracer.Configure(flowtraceConfig);

// Add services
builder.Services.AddSingleton<ProductDatabase>();
builder.Services.AddSingleton<ProductService>();

var app = builder.Build();

// FlowTrace Middleware - HTTP Request/Response tracking
app.Use(async (context, next) =>
{
    var requestId = Guid.NewGuid().ToString();
    var startTime = DateTime.UtcNow;

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
            ["remote_addr"] = context.Connection.RemoteIpAddress?.ToString() ?? "unknown"
        }
    });

    await next();

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
});

// API Endpoints
app.MapGet("/", () => new
{
    message = "FlowTrace .NET Agent - AspNetCore Advanced Example",
    version = "1.0.0",
    endpoints = new[]
    {
        "GET /products - List all products",
        "GET /products/{id} - Get product by ID",
        "POST /products - Create new product",
        "PUT /products/{id} - Update product",
        "DELETE /products/{id} - Delete product"
    }
});

app.MapGet("/products", async ([FromServices] ProductService service) =>
{
    var products = await service.GetAllProductsAsync();
    return Results.Ok(products);
});

app.MapGet("/products/{id:int}", async (int id, [FromServices] ProductService service) =>
{
    var product = await service.GetProductByIdAsync(id);
    return product != null ? Results.Ok(product) : Results.NotFound(new { error = "Product not found" });
});

app.MapPost("/products", async ([FromBody] CreateProductRequest request, [FromServices] ProductService service) =>
{
    var validation = service.ValidateProductData(request.Name, request.Price, request.Stock);
    if (validation.Any())
    {
        return Results.BadRequest(new { errors = validation });
    }

    var product = await service.CreateProductAsync(request.Name, request.Price, request.Stock);
    return Results.Created($"/products/{product.Id}", product);
});

app.MapPut("/products/{id:int}", async (int id, [FromBody] UpdateProductRequest request, [FromServices] ProductService service) =>
{
    var validation = service.ValidateProductData(request.Name, request.Price, request.Stock);
    if (validation.Any())
    {
        return Results.BadRequest(new { errors = validation });
    }

    var product = await service.UpdateProductAsync(id, request.Name, request.Price, request.Stock);
    return product != null ? Results.Ok(product) : Results.NotFound(new { error = "Product not found" });
});

app.MapDelete("/products/{id:int}", async (int id, [FromServices] ProductService service) =>
{
    var success = await service.DeleteProductAsync(id);
    return success ? Results.NoContent() : Results.NotFound(new { error = "Product not found" });
});

Console.WriteLine("🚀 AspNetCore Advanced Example - Running on http://localhost:5000");
Console.WriteLine("📊 FlowTrace logging to: flowtrace.jsonl");
Console.WriteLine("\nExample requests:");
Console.WriteLine("  curl http://localhost:5000/products");
Console.WriteLine("  curl -X POST http://localhost:5000/products -H 'Content-Type: application/json' -d '{\"name\":\"Laptop\",\"price\":999.99,\"stock\":10}'");

app.Run();

// ==================== Models ====================

public record Product(int Id, string Name, decimal Price, int Stock, DateTime CreatedAt, DateTime UpdatedAt);

public record CreateProductRequest(string Name, decimal Price, int Stock);

public record UpdateProductRequest(string Name, decimal Price, int Stock);

// ==================== Database ====================

public partial class ProductDatabase
{
    private readonly ConcurrentDictionary<int, Product> _products = new();
    private int _nextId = 1;

    [Trace]
    public async Task<Product> InsertAsync(string name, decimal price, int stock)
    {
        // Simulate database delay
        await Task.Delay(10);

        var now = DateTime.UtcNow;
        var id = Interlocked.Increment(ref _nextId) - 1;
        var product = new Product(id, name, price, stock, now, now);

        _products[id] = product;
        return product;
    }

    [Trace]
    public async Task<Product?> FindByIdAsync(int id)
    {
        // Simulate database query delay
        await Task.Delay(5);

        return _products.TryGetValue(id, out var product) ? product : null;
    }

    [Trace]
    public async Task<List<Product>> FindAllAsync()
    {
        // Simulate database query delay
        await Task.Delay(8);

        return _products.Values.OrderBy(p => p.Id).ToList();
    }

    [Trace]
    public async Task<Product?> UpdateAsync(int id, string name, decimal price, int stock)
    {
        // Simulate database update delay
        await Task.Delay(12);

        if (!_products.TryGetValue(id, out var existing))
        {
            return null;
        }

        var updated = existing with
        {
            Name = name,
            Price = price,
            Stock = stock,
            UpdatedAt = DateTime.UtcNow
        };

        _products[id] = updated;
        return updated;
    }

    [Trace]
    public async Task<bool> DeleteAsync(int id)
    {
        // Simulate database delete delay
        await Task.Delay(7);

        return _products.TryRemove(id, out _);
    }

    [TraceIgnore]
    public int Count() => _products.Count;
}

// ==================== Service Layer ====================

public partial class ProductService
{
    private readonly ProductDatabase _database;

    public ProductService(ProductDatabase database)
    {
        _database = database;
    }

    [Trace]
    public async Task<List<Product>> GetAllProductsAsync()
    {
        var products = await _database.FindAllAsyncTraced();
        return products;
    }

    [Trace]
    public async Task<Product?> GetProductByIdAsync(int id)
    {
        if (id <= 0)
        {
            throw new ArgumentException("Product ID must be positive", nameof(id));
        }

        var product = await _database.FindByIdAsyncTraced(id);
        return product;
    }

    [Trace]
    public async Task<Product> CreateProductAsync(string name, decimal price, int stock)
    {
        var product = await _database.InsertAsyncTraced(name, price, stock);
        return product;
    }

    [Trace]
    public async Task<Product?> UpdateProductAsync(int id, string name, decimal price, int stock)
    {
        if (id <= 0)
        {
            throw new ArgumentException("Product ID must be positive", nameof(id));
        }

        var product = await _database.UpdateAsyncTraced(id, name, price, stock);
        return product;
    }

    [Trace]
    public async Task<bool> DeleteProductAsync(int id)
    {
        if (id <= 0)
        {
            throw new ArgumentException("Product ID must be positive", nameof(id));
        }

        var success = await _database.DeleteAsyncTraced(id);
        return success;
    }

    [Trace]
    public List<string> ValidateProductData(string name, decimal price, int stock)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(name))
        {
            errors.Add("Name is required");
        }
        else if (name.Length < 3)
        {
            errors.Add("Name must be at least 3 characters");
        }
        else if (name.Length > 100)
        {
            errors.Add("Name must not exceed 100 characters");
        }

        if (price <= 0)
        {
            errors.Add("Price must be positive");
        }
        else if (price > 1_000_000)
        {
            errors.Add("Price must not exceed 1,000,000");
        }

        if (stock < 0)
        {
            errors.Add("Stock cannot be negative");
        }
        else if (stock > 10_000)
        {
            errors.Add("Stock must not exceed 10,000");
        }

        return errors;
    }

    [TraceIgnore]
    public int GetProductCount()
    {
        // Internal helper - not traced
        return _database.Count();
    }
}
