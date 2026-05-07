# FlowTrace .NET Agent - Microservice Example

Production-ready microservice architecture demonstrating service layer pattern, dependency injection, caching, and comprehensive FlowTrace instrumentation across multiple service boundaries.

## Features

- ✅ **Service Layer Architecture**: Clean separation of concerns (Product, Order, Cache, Database, Logger)
- ✅ **Dependency Injection**: ASP.NET Core DI with service registration
- ✅ **Caching Strategy**: Cache-aside pattern with TTL and invalidation
- ✅ **Purchase Workflow**: Multi-step business process with validation and error handling
- ✅ **Cross-Service Tracing**: Track operations across multiple service boundaries
- ✅ **Async Operations**: Full async/await throughout all layers
- ✅ **Error Handling**: Comprehensive validation and exception handling

## Architecture

```
HTTP Request
    ↓
[PurchaseWorkflow] → [Trace] ProcessPurchaseAsync
    ├─→ [ProductService] → [Trace] GetProductByIdAsync
    │       ├─→ [CacheService] → [Trace] GetAsync
    │       └─→ [DatabaseService] → [Trace] QueryProductAsync
    │
    ├─→ [ProductService] → [Trace] DecrementStockAsync
    │       ├─→ [DatabaseService] → [Trace] UpdateProductStockAsync
    │       └─→ [CacheService] → [Trace] InvalidateAsync
    │
    └─→ [OrderService] → [Trace] CreateOrderAsync
            └─→ [DatabaseService] → [Trace] InsertOrderAsync
```

## Service Layers

### 1. Cache Service
- In-memory caching with TTL
- Get, Set, Invalidate operations
- Simulated cache latency (1-2ms)

### 2. Database Service
- Product and Order storage
- CRUD operations
- Simulated database latency (10-15ms)

### 3. Logger Service
- Structured logging (Info, Warning, Error)
- Metadata support
- Async logging operations

### 4. Product Service
- Cache-aside pattern implementation
- Stock management
- Product retrieval

### 5. Order Service
- Order creation
- Order retrieval

### 6. Purchase Workflow
- Orchestrates multi-step purchase process
- Validation, stock reservation, order creation
- Cross-service coordination

## Running the Example

```bash
cd examples/Microservice
dotnet build
dotnet run
```

The API will start on http://localhost:5002

## API Endpoints

### List All Products
```bash
curl http://localhost:5002/products
```

**Response**:
```json
[
  {"id": 1, "name": "Laptop", "price": 999.99, "stock": 10},
  {"id": 2, "name": "Mouse", "price": 29.99, "stock": 50},
  {"id": 3, "name": "Keyboard", "price": 79.99, "stock": 30}
]
```

### Get Product by ID
```bash
curl http://localhost:5002/products/1
```

**Response**:
```json
{"id": 1, "name": "Laptop", "price": 999.99, "stock": 10}
```

### Process Purchase
```bash
curl -X POST http://localhost:5002/purchase \
  -H 'Content-Type: application/json' \
  -d '{
    "productId": 1,
    "quantity": 2,
    "customerId": 123
  }'
```

**Response** (200 OK):
```json
{
  "orderId": "a1b2c3d4e5f6",
  "status": "success",
  "message": "Order a1b2c3d4e5f6 created successfully. Total: $1999.98"
}
```

### Purchase with Insufficient Stock
```bash
curl -X POST http://localhost:5002/purchase \
  -H 'Content-Type: application/json' \
  -d '{
    "productId": 1,
    "quantity": 100,
    "customerId": 123
  }'
```

**Response** (400 Bad Request):
```json
{
  "error": "Insufficient stock for product 1"
}
```

## Trace Output - Complete Purchase Flow

### Workflow Start
```json
{
  "timestamp": 1705318200000,
  "event": "ENTER",
  "thread": "42",
  "class": "PurchaseWorkflow",
  "function": "ProcessPurchaseAsync",
  "args": "{\"productId\":1,\"quantity\":2,\"customerId\":123}"
}
```

### Step 1: Get Product (Cache Hit)
```json
{
  "timestamp": 1705318200010,
  "event": "ENTER",
  "thread": "42",
  "class": "ProductService",
  "function": "GetProductByIdAsync",
  "args": "{\"productId\":1}"
}
```

```json
{
  "timestamp": 1705318200011,
  "event": "ENTER",
  "thread": "42",
  "class": "CacheService",
  "function": "GetAsync",
  "args": "{\"key\":\"product:1\"}"
}
```

```json
{
  "timestamp": 1705318200012,
  "event": "EXIT",
  "thread": "42",
  "class": "CacheService",
  "function": "GetAsync",
  "result": "{\"id\":1,\"name\":\"Laptop\",\"price\":999.99,\"stock\":10}",
  "durationMicros": 1000,
  "durationMillis": 1
}
```

### Step 2: Decrement Stock
```json
{
  "timestamp": 1705318200020,
  "event": "ENTER",
  "thread": "42",
  "class": "ProductService",
  "function": "DecrementStockAsync",
  "args": "{\"productId\":1,\"quantity\":2}"
}
```

```json
{
  "timestamp": 1705318200030,
  "event": "ENTER",
  "thread": "42",
  "class": "DatabaseService",
  "function": "UpdateProductStockAsync",
  "args": "{\"productId\":1,\"newStock\":8}"
}
```

```json
{
  "timestamp": 1705318200042,
  "event": "EXIT",
  "thread": "42",
  "class": "DatabaseService",
  "function": "UpdateProductStockAsync",
  "result": "true",
  "durationMicros": 12000,
  "durationMillis": 12
}
```

### Cache Invalidation
```json
{
  "timestamp": 1705318200043,
  "event": "ENTER",
  "thread": "42",
  "class": "CacheService",
  "function": "InvalidateAsync",
  "args": "{\"key\":\"product:1\"}"
}
```

### Step 3: Create Order
```json
{
  "timestamp": 1705318200050,
  "event": "ENTER",
  "thread": "42",
  "class": "OrderService",
  "function": "CreateOrderAsync",
  "args": "{\"productId\":1,\"quantity\":2,\"customerId\":123,\"totalPrice\":1999.98}"
}
```

```json
{
  "timestamp": 1705318200065,
  "event": "EXIT",
  "thread": "42",
  "class": "OrderService",
  "function": "CreateOrderAsync",
  "result": "{\"orderId\":\"a1b2c3d4e5f6\",\"status\":\"pending\",\"totalPrice\":1999.98}",
  "durationMicros": 15000,
  "durationMillis": 15
}
```

### Workflow Complete
```json
{
  "timestamp": 1705318200070,
  "event": "EXIT",
  "thread": "42",
  "class": "PurchaseWorkflow",
  "function": "ProcessPurchaseAsync",
  "result": "{\"orderId\":\"a1b2c3d4e5f6\",\"status\":\"success\"}",
  "durationMicros": 70000,
  "durationMillis": 70
}
```

## Code Structure

### Cache Service
```csharp
public partial class CacheService
{
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
        if (_cache.TryGetValue(key, out var cached) && cached.Expiry > DateTime.UtcNow)
        {
            return (T)cached.Value;
        }
        return default;
    }

    [Trace]
    public async Task InvalidateAsync(string key)
    {
        await Task.Delay(1);
        _cache.TryRemove(key, out _);
    }
}
```

### Product Service (with Cache-Aside Pattern)
```csharp
public partial class ProductService
{
    [Trace]
    public async Task<Product?> GetProductByIdAsync(int productId)
    {
        // Check cache first
        var cacheKey = $"product:{productId}";
        var cached = await _cache.GetAsyncTraced<Product>(cacheKey);
        if (cached != null)
        {
            return cached;
        }

        // Cache miss, query database
        var product = await _database.QueryProductAsyncTraced(productId);
        if (product != null)
        {
            // Store in cache for 5 minutes
            await _cache.SetAsyncTraced(cacheKey, product, TimeSpan.FromMinutes(5));
        }
        return product;
    }

    [Trace]
    public async Task<bool> DecrementStockAsync(int productId, int quantity)
    {
        // Validation, database update, cache invalidation
        var newStock = product.Stock - quantity;
        var success = await _database.UpdateProductStockAsyncTraced(productId, newStock);
        if (success)
        {
            await _cache.InvalidateAsyncTraced($"product:{productId}");
        }
        return success;
    }
}
```

### Purchase Workflow (Multi-Step Orchestration)
```csharp
public partial class PurchaseWorkflow
{
    [Trace]
    public async Task<PurchaseResult> ProcessPurchaseAsync(int productId, int quantity, int customerId)
    {
        // Step 1: Validate product exists
        var product = await _productService.GetProductByIdAsyncTraced(productId);
        if (product == null)
        {
            throw new InvalidOperationException($"Product {productId} not found");
        }

        // Step 2: Check stock and reserve
        var stockSuccess = await _productService.DecrementStockAsyncTraced(productId, quantity);
        if (!stockSuccess)
        {
            throw new InvalidOperationException($"Insufficient stock for product {productId}");
        }

        // Step 3: Calculate total
        var totalPrice = product.Price * quantity;

        // Step 4: Create order
        var order = await _orderService.CreateOrderAsyncTraced(productId, quantity, customerId, totalPrice);

        return new PurchaseResult(order.OrderId, "success", $"Order {order.OrderId} created");
    }
}
```

## Cache Strategy

### Cache-Aside Pattern
1. **Read**: Check cache → Cache miss → Query database → Store in cache
2. **Write**: Update database → Invalidate cache
3. **TTL**: Products cached for 5 minutes, product lists for 2 minutes

### Cache Keys
- `product:{id}` - Individual product cache
- `products:all` - All products list cache

## Testing Scenarios

### Test Cache Hit
```bash
# First request (cache miss)
time curl http://localhost:5002/products/1

# Second request (cache hit - faster)
time curl http://localhost:5002/products/1
```

### Test Stock Management
```bash
# Check initial stock
curl http://localhost:5002/products/1
# Response: {"id":1,"name":"Laptop","price":999.99,"stock":10}

# Purchase 2 units
curl -X POST http://localhost:5002/purchase \
  -H 'Content-Type: application/json' \
  -d '{"productId":1,"quantity":2,"customerId":123}'

# Check updated stock (cache invalidated, should show 8)
curl http://localhost:5002/products/1
# Response: {"id":1,"name":"Laptop","price":999.99,"stock":8}
```

### Test Insufficient Stock Error
```bash
curl -X POST http://localhost:5002/purchase \
  -H 'Content-Type: application/json' \
  -d '{"productId":1,"quantity":100,"customerId":123}'

# Response: 400 Bad Request
# {"error":"Insufficient stock for product 1"}
```

### Test Product Not Found
```bash
curl -X POST http://localhost:5002/purchase \
  -H 'Content-Type: application/json' \
  -d '{"productId":999,"quantity":1,"customerId":123}'

# Response: 400 Bad Request
# {"error":"Product 999 not found"}
```

## Performance Characteristics

### Latency Breakdown
- **Cache Hit**: ~1ms (cache latency)
- **Cache Miss**: ~11ms (1ms cache + 10ms database)
- **Stock Update**: ~12ms (database update)
- **Cache Invalidation**: ~1ms per key
- **Order Creation**: ~15ms (database insert)
- **Total Purchase**: ~40-70ms (depends on cache hit/miss)

### Simulated Latencies
- **Cache Read**: 1ms
- **Cache Write**: 2ms
- **Database Query**: 10-15ms
- **Database Update**: 12ms
- **Database Insert**: 15ms
- **Logging**: 1ms per log

## Dependency Injection

### Service Registration
```csharp
builder.Services.AddSingleton<CacheService>();
builder.Services.AddSingleton<DatabaseService>();
builder.Services.AddSingleton<LoggerService>();
builder.Services.AddSingleton<ProductService>();
builder.Services.AddSingleton<OrderService>();
builder.Services.AddSingleton<PurchaseWorkflow>();
```

### Service Constructor Injection
```csharp
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
}
```

## Key Points

1. **Service Layer Pattern**: Clean separation between Cache, Database, Product, Order, and Workflow layers
2. **Dependency Injection**: ASP.NET Core DI manages all service lifetimes and dependencies
3. **Cache-Aside Pattern**: Cache read with database fallback, cache invalidation on writes
4. **Cross-Service Tracing**: Every service method is traced, showing complete call chains
5. **Error Handling**: Validation at each step with proper exception propagation
6. **Async Throughout**: All service methods use async/await for scalability
7. **Partial Classes**: Required for Source Generator to extend service classes

## Console Output

```
🚀 Microservice Example - Running on http://localhost:5002
📊 FlowTrace logging to: flowtrace.jsonl

[INFO] Starting purchase workflow
       Metadata: {"productId":1,"quantity":2,"customerId":123}
[INFO] Product cache miss, querying database
       Metadata: {"productId":1}
[INFO] Stock decremented
       Metadata: {"productId":1,"quantity":2,"newStock":8}
[INFO] Order created
       Metadata: {"orderId":"a1b2c3d4e5f6","productId":1,"quantity":2,"customerId":123}
[INFO] Purchase workflow completed successfully
       Metadata: {"orderId":"a1b2c3d4e5f6","totalPrice":1999.98}
```

## Comparison with Other Examples

| Feature | Microservice | AspNetCore Advanced | Minimal API Realtime |
|---------|-------------|---------------------|---------------------|
| Architecture | Service layers | REST API | WebSocket chat |
| Services | 6 services + workflow | 2 services | 2 services |
| Caching | ✅ Cache-aside pattern | ❌ No caching | ❌ No caching |
| DI | ✅ Full DI | ✅ Full DI | ✅ Full DI |
| Workflow | ✅ Multi-step orchestration | ❌ Simple CRUD | ❌ Real-time messaging |
| Latency | ~40-70ms purchase | ~70ms create | ~1-2ms per message |

## Next Steps

- See `../AspNetCoreAdvanced` for REST API CRUD example
- See `../MinimalApiRealtime` for WebSocket real-time example
- See `../../docs/source-generators.md` for Source Generator details
- See `../../docs/dependency-injection.md` for DI patterns

## Production Considerations

### Add to Real Microservices:
- **Real Database**: Replace ConcurrentDictionary with Entity Framework Core or Dapper
- **Distributed Cache**: Use Redis or Memcached instead of in-memory cache
- **Message Queue**: Add RabbitMQ or Kafka for async order processing
- **API Gateway**: Add Ocelot or YARP for routing and load balancing
- **Health Checks**: Implement ASP.NET Core health check endpoints
- **Metrics**: Add Prometheus metrics for monitoring
- **Retries**: Implement Polly for transient fault handling
- **Authentication**: Add JWT or OAuth2 for API security
