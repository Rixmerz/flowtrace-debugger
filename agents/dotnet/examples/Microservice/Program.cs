using System.Collections.Concurrent;
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

// Register services (Dependency Injection)
builder.Services.AddSingleton<CacheService>();
builder.Services.AddSingleton<DatabaseService>();
builder.Services.AddSingleton<LoggerService>();
builder.Services.AddSingleton<ProductService>();
builder.Services.AddSingleton<OrderService>();
builder.Services.AddSingleton<PurchaseWorkflow>();

var app = builder.Build();

// Home endpoint
app.MapGet("/", () => new
{
    service = "FlowTrace Microservice Example",
    version = "1.0.0",
    endpoints = new[]
    {
        "GET /products - List products",
        "GET /products/{id} - Get product",
        "POST /purchase - Process purchase order"
    }
});

// Product endpoints
app.MapGet("/products", async ([FromServices] ProductService service) =>
{
    var products = await service.GetAllProductsAsyncTraced();
    return Results.Ok(products);
});

app.MapGet("/products/{id:int}", async (int id, [FromServices] ProductService service) =>
{
    var product = await service.GetProductByIdAsyncTraced(id);
    return product != null ? Results.Ok(product) : Results.NotFound();
});

// Purchase endpoint
app.MapPost("/purchase", async ([FromBody] PurchaseRequest request, [FromServices] PurchaseWorkflow workflow) =>
{
    try
    {
        var result = await workflow.ProcessPurchaseAsyncTraced(request.ProductId, request.Quantity, request.CustomerId);
        return Results.Ok(result);
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

Console.WriteLine("🚀 Microservice Example - Running on http://localhost:5002");
Console.WriteLine("📊 FlowTrace logging to: flowtrace.jsonl");

app.Run("http://localhost:5002");

// ==================== Models ====================

public record Product(int Id, string Name, decimal Price, int Stock);

public record Order(string OrderId, int ProductId, int Quantity, int CustomerId, decimal TotalPrice, DateTime CreatedAt, string Status);

public record PurchaseRequest(int ProductId, int Quantity, int CustomerId);

public record PurchaseResult(string OrderId, string Status, string Message);

// ==================== Cache Service ====================

public partial class CacheService
{
    private readonly ConcurrentDictionary<string, (object Value, DateTime Expiry)> _cache = new();

    [Trace]
    public async Task SetAsync<T>(string key, T value, TimeSpan ttl)
    {
        await Task.Delay(2); // Simulate cache write latency
        var expiry = DateTime.UtcNow.Add(ttl);
        _cache[key] = (value!, expiry);
    }

    [Trace]
    public async Task<T?> GetAsync<T>(string key)
    {
        await Task.Delay(1); // Simulate cache read latency

        if (_cache.TryGetValue(key, out var cached))
        {
            if (cached.Expiry > DateTime.UtcNow)
            {
                return (T)cached.Value;
            }
            else
            {
                // Expired, remove
                _cache.TryRemove(key, out _);
            }
        }

        return default;
    }

    [Trace]
    public async Task InvalidateAsync(string key)
    {
        await Task.Delay(1); // Simulate cache invalidation
        _cache.TryRemove(key, out _);
    }

    [TraceIgnore]
    public int Count() => _cache.Count;
}

// ==================== Database Service ====================

public partial class DatabaseService
{
    private readonly ConcurrentDictionary<int, Product> _products = new();
    private readonly ConcurrentDictionary<string, Order> _orders = new();

    public DatabaseService()
    {
        // Seed initial data
        _products[1] = new Product(1, "Laptop", 999.99m, 10);
        _products[2] = new Product(2, "Mouse", 29.99m, 50);
        _products[3] = new Product(3, "Keyboard", 79.99m, 30);
    }

    [Trace]
    public async Task<Product?> QueryProductAsync(int productId)
    {
        await Task.Delay(10); // Simulate database query latency
        return _products.TryGetValue(productId, out var product) ? product : null;
    }

    [Trace]
    public async Task<List<Product>> QueryAllProductsAsync()
    {
        await Task.Delay(15); // Simulate database query latency
        return _products.Values.OrderBy(p => p.Id).ToList();
    }

    [Trace]
    public async Task<bool> UpdateProductStockAsync(int productId, int newStock)
    {
        await Task.Delay(12); // Simulate database update latency

        if (!_products.TryGetValue(productId, out var product))
        {
            return false;
        }

        _products[productId] = product with { Stock = newStock };
        return true;
    }

    [Trace]
    public async Task<Order> InsertOrderAsync(Order order)
    {
        await Task.Delay(15); // Simulate database insert latency
        _orders[order.OrderId] = order;
        return order;
    }

    [Trace]
    public async Task<Order?> QueryOrderAsync(string orderId)
    {
        await Task.Delay(10); // Simulate database query latency
        return _orders.TryGetValue(orderId, out var order) ? order : null;
    }

    [TraceIgnore]
    public int GetProductCount() => _products.Count;
}

// ==================== Logger Service ====================

public partial class LoggerService
{
    [Trace]
    public async Task LogInfoAsync(string message, object? metadata = null)
    {
        await Task.Delay(1); // Simulate async logging
        Console.WriteLine($"[INFO] {message}");
        if (metadata != null)
        {
            Console.WriteLine($"       Metadata: {System.Text.Json.JsonSerializer.Serialize(metadata)}");
        }
    }

    [Trace]
    public async Task LogWarningAsync(string message, object? metadata = null)
    {
        await Task.Delay(1);
        Console.WriteLine($"[WARN] {message}");
        if (metadata != null)
        {
            Console.WriteLine($"       Metadata: {System.Text.Json.JsonSerializer.Serialize(metadata)}");
        }
    }

    [Trace]
    public async Task LogErrorAsync(string message, Exception? ex = null, object? metadata = null)
    {
        await Task.Delay(1);
        Console.WriteLine($"[ERROR] {message}");
        if (ex != null)
        {
            Console.WriteLine($"        Exception: {ex.Message}");
        }
        if (metadata != null)
        {
            Console.WriteLine($"        Metadata: {System.Text.Json.JsonSerializer.Serialize(metadata)}");
        }
    }

    [TraceIgnore]
    public void LogDebug(string message)
    {
        // Debug logging not traced
        Console.WriteLine($"[DEBUG] {message}");
    }
}

// ==================== Product Service ====================

public partial class ProductService
{
    private readonly DatabaseService _database;
    private readonly CacheService _cache;
    private readonly LoggerService _logger;

    public ProductService(DatabaseService database, CacheService cache, LoggerService logger)
    {
        _database = database;
        _cache = cache;
        _logger = logger;
    }

    [Trace]
    public async Task<Product?> GetProductByIdAsync(int productId)
    {
        // Check cache first
        var cacheKey = $"product:{productId}";
        var cached = await _cache.GetAsyncTraced<Product>(cacheKey);

        if (cached != null)
        {
            await _logger.LogInfoAsyncTraced("Product found in cache", new { productId });
            return cached;
        }

        // Cache miss, query database
        await _logger.LogInfoAsyncTraced("Product cache miss, querying database", new { productId });
        var product = await _database.QueryProductAsyncTraced(productId);

        if (product != null)
        {
            // Store in cache for 5 minutes
            await _cache.SetAsyncTraced(cacheKey, product, TimeSpan.FromMinutes(5));
        }

        return product;
    }

    [Trace]
    public async Task<List<Product>> GetAllProductsAsync()
    {
        var cacheKey = "products:all";
        var cached = await _cache.GetAsyncTraced<List<Product>>(cacheKey);

        if (cached != null)
        {
            await _logger.LogInfoAsyncTraced("Products found in cache");
            return cached;
        }

        await _logger.LogInfoAsyncTraced("Products cache miss, querying database");
        var products = await _database.QueryAllProductsAsyncTraced();

        // Cache for 2 minutes
        await _cache.SetAsyncTraced(cacheKey, products, TimeSpan.FromMinutes(2));

        return products;
    }

    [Trace]
    public async Task<bool> DecrementStockAsync(int productId, int quantity)
    {
        var product = await GetProductByIdAsyncTraced(productId);

        if (product == null)
        {
            await _logger.LogWarningAsyncTraced("Product not found", new { productId });
            return false;
        }

        if (product.Stock < quantity)
        {
            await _logger.LogWarningAsyncTraced("Insufficient stock", new { productId, requested = quantity, available = product.Stock });
            return false;
        }

        var newStock = product.Stock - quantity;
        var success = await _database.UpdateProductStockAsyncTraced(productId, newStock);

        if (success)
        {
            // Invalidate cache
            await _cache.InvalidateAsyncTraced($"product:{productId}");
            await _cache.InvalidateAsyncTraced("products:all");

            await _logger.LogInfoAsyncTraced("Stock decremented", new { productId, quantity, newStock });
        }

        return success;
    }
}

// ==================== Order Service ====================

public partial class OrderService
{
    private readonly DatabaseService _database;
    private readonly LoggerService _logger;

    public OrderService(DatabaseService database, LoggerService logger)
    {
        _database = database;
        _logger = logger;
    }

    [Trace]
    public async Task<Order> CreateOrderAsync(int productId, int quantity, int customerId, decimal totalPrice)
    {
        var orderId = Guid.NewGuid().ToString("N")[..12];

        var order = new Order(
            OrderId: orderId,
            ProductId: productId,
            Quantity: quantity,
            CustomerId: customerId,
            TotalPrice: totalPrice,
            CreatedAt: DateTime.UtcNow,
            Status: "pending"
        );

        await _database.InsertOrderAsyncTraced(order);
        await _logger.LogInfoAsyncTraced("Order created", new { orderId, productId, quantity, customerId });

        return order;
    }

    [Trace]
    public async Task<Order?> GetOrderAsync(string orderId)
    {
        return await _database.QueryOrderAsyncTraced(orderId);
    }
}

// ==================== Purchase Workflow ====================

public partial class PurchaseWorkflow
{
    private readonly ProductService _productService;
    private readonly OrderService _orderService;
    private readonly LoggerService _logger;

    public PurchaseWorkflow(ProductService productService, OrderService orderService, LoggerService logger)
    {
        _productService = productService;
        _orderService = orderService;
        _logger = logger;
    }

    [Trace]
    public async Task<PurchaseResult> ProcessPurchaseAsync(int productId, int quantity, int customerId)
    {
        await _logger.LogInfoAsyncTraced("Starting purchase workflow",
            new { productId, quantity, customerId });

        // Step 1: Validate product exists and get price
        var product = await _productService.GetProductByIdAsyncTraced(productId);

        if (product == null)
        {
            await _logger.LogErrorAsyncTraced("Purchase failed: Product not found", null, new { productId });
            throw new InvalidOperationException($"Product {productId} not found");
        }

        // Step 2: Check stock and reserve
        var stockSuccess = await _productService.DecrementStockAsyncTraced(productId, quantity);

        if (!stockSuccess)
        {
            await _logger.LogErrorAsyncTraced("Purchase failed: Insufficient stock", null,
                new { productId, quantity, availableStock = product.Stock });
            throw new InvalidOperationException($"Insufficient stock for product {productId}");
        }

        // Step 3: Calculate total price
        var totalPrice = product.Price * quantity;

        // Step 4: Create order
        var order = await _orderService.CreateOrderAsyncTraced(productId, quantity, customerId, totalPrice);

        await _logger.LogInfoAsyncTraced("Purchase workflow completed successfully",
            new { orderId = order.OrderId, totalPrice });

        return new PurchaseResult(
            OrderId: order.OrderId,
            Status: "success",
            Message: $"Order {order.OrderId} created successfully. Total: ${totalPrice:F2}"
        );
    }
}
