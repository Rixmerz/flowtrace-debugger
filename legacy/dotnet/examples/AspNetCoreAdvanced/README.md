# FlowTrace .NET Agent - AspNetCore Advanced Example

Complete REST API demonstration with CRUD operations, database simulation, validation, and comprehensive FlowTrace instrumentation.

## Features

- ✅ **Complete REST API**: Full CRUD operations for products
- ✅ **Database Simulation**: In-memory ConcurrentDictionary with async operations
- ✅ **Service Layer**: Business logic separation with validation
- ✅ **HTTP Middleware**: Request/Response tracking with request_id
- ✅ **Method Tracing**: All service and database methods traced with [Trace]
- ✅ **Error Handling**: Validation, exceptions, and error responses
- ✅ **Async/Await**: Full async operations throughout the stack

## Architecture

```
HTTP Request
    ↓
[FlowTrace Middleware] → HTTP_REQUEST event
    ↓
[ASP.NET Core Endpoints]
    ↓
[ProductService] → [Trace] ENTER/EXIT events
    ↓
[ProductDatabase] → [Trace] ENTER/EXIT events
    ↓
[FlowTrace Middleware] → HTTP_RESPONSE event
```

## Running the Example

```bash
cd examples/AspNetCoreAdvanced
dotnet build
dotnet run
```

The API will start on http://localhost:5000

## API Endpoints

### List All Products
```bash
curl http://localhost:5000/products
```

**Response**:
```json
[
  {
    "id": 0,
    "name": "Laptop",
    "price": 999.99,
    "stock": 10,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
]
```

### Get Product by ID
```bash
curl http://localhost:5000/products/0
```

### Create Product
```bash
curl -X POST http://localhost:5000/products \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Laptop",
    "price": 999.99,
    "stock": 10
  }'
```

**Response** (201 Created):
```json
{
  "id": 0,
  "name": "Laptop",
  "price": 999.99,
  "stock": 10,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### Update Product
```bash
curl -X PUT http://localhost:5000/products/0 \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Gaming Laptop",
    "price": 1299.99,
    "stock": 5
  }'
```

### Delete Product
```bash
curl -X DELETE http://localhost:5000/products/0
```

**Response** (204 No Content)

## Validation Rules

The API validates all product data:

- **Name**: 3-100 characters, required
- **Price**: Positive, ≤ 1,000,000
- **Stock**: Non-negative, ≤ 10,000

**Example validation error**:
```bash
curl -X POST http://localhost:5000/products \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "price": -10, "stock": -5}'
```

**Response** (400 Bad Request):
```json
{
  "errors": [
    "Name must be at least 3 characters",
    "Price must be positive",
    "Stock cannot be negative"
  ]
}
```

## Trace Output

### HTTP Request Event
```json
{
  "timestamp": 1705318200000,
  "event": "HTTP_REQUEST",
  "thread": "42",
  "metadata": {
    "request_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
    "method": "POST",
    "path": "/products",
    "remote_addr": "127.0.0.1"
  }
}
```

### Service Method - ENTER
```json
{
  "timestamp": 1705318200100,
  "event": "ENTER",
  "thread": "42",
  "class": "ProductService",
  "function": "CreateProductAsync",
  "args": "{\"name\":\"Laptop\",\"price\":999.99,\"stock\":10}"
}
```

### Database Method - ENTER
```json
{
  "timestamp": 1705318200150,
  "event": "ENTER",
  "thread": "42",
  "class": "ProductDatabase",
  "function": "InsertAsync",
  "args": "{\"name\":\"Laptop\",\"price\":999.99,\"stock\":10}"
}
```

### Database Method - EXIT
```json
{
  "timestamp": 1705318200165,
  "event": "EXIT",
  "thread": "42",
  "class": "ProductDatabase",
  "function": "InsertAsync",
  "result": "{\"id\":0,\"name\":\"Laptop\",\"price\":999.99,\"stock\":10,\"createdAt\":\"2024-01-15T10:30:00Z\",\"updatedAt\":\"2024-01-15T10:30:00Z\"}",
  "durationMicros": 15000,
  "durationMillis": 15
}
```

### Service Method - EXIT
```json
{
  "timestamp": 1705318200170,
  "event": "EXIT",
  "thread": "42",
  "class": "ProductService",
  "function": "CreateProductAsync",
  "result": "{\"id\":0,\"name\":\"Laptop\",\"price\":999.99,\"stock\":10,\"createdAt\":\"2024-01-15T10:30:00Z\",\"updatedAt\":\"2024-01-15T10:30:00Z\"}",
  "durationMicros": 70000,
  "durationMillis": 70
}
```

### HTTP Response Event
```json
{
  "timestamp": 1705318200180,
  "event": "HTTP_RESPONSE",
  "thread": "42",
  "metadata": {
    "request_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
    "method": "POST",
    "path": "/products",
    "status_code": 201,
    "duration_millis": 80
  }
}
```

## Code Structure

### ProductDatabase (Data Layer)
```csharp
public partial class ProductDatabase
{
    [Trace]
    public async Task<Product> InsertAsync(string name, decimal price, int stock)
    {
        // Simulated database operation with delay
        await Task.Delay(10);
        var product = new Product(id, name, price, stock, now, now);
        _products[id] = product;
        return product;
    }

    [Trace]
    public async Task<Product?> FindByIdAsync(int id) { ... }

    [Trace]
    public async Task<List<Product>> FindAllAsync() { ... }

    [Trace]
    public async Task<Product?> UpdateAsync(...) { ... }

    [Trace]
    public async Task<bool> DeleteAsync(int id) { ... }
}
```

### ProductService (Business Layer)
```csharp
public partial class ProductService
{
    [Trace]
    public async Task<Product> CreateProductAsync(string name, decimal price, int stock)
    {
        var product = await _database.InsertAsyncTraced(name, price, stock);
        return product;
    }

    [Trace]
    public List<string> ValidateProductData(string name, decimal price, int stock)
    {
        var errors = new List<string>();
        // Validation logic
        return errors;
    }
}
```

### ASP.NET Core Endpoints
```csharp
app.MapPost("/products", async ([FromBody] CreateProductRequest request,
                                [FromServices] ProductService service) =>
{
    var validation = service.ValidateProductData(request.Name, request.Price, request.Stock);
    if (validation.Any())
    {
        return Results.BadRequest(new { errors = validation });
    }

    var product = await service.CreateProductAsync(request.Name, request.Price, request.Stock);
    return Results.Created($"/products/{product.Id}", product);
});
```

## Complete Request Flow Example

**Request**: `POST /products` with `{"name": "Laptop", "price": 999.99, "stock": 10}`

**Trace Events** (in order):
1. `HTTP_REQUEST` - Middleware captures request
2. `ENTER ProductService.ValidateProductData` - Validation starts
3. `EXIT ProductService.ValidateProductData` - Validation passes (empty errors list)
4. `ENTER ProductService.CreateProductAsync` - Create starts
5. `ENTER ProductDatabase.InsertAsync` - Database insert starts
6. `EXIT ProductDatabase.InsertAsync` - Database insert complete (15ms)
7. `EXIT ProductService.CreateProductAsync` - Create complete (70ms total)
8. `HTTP_RESPONSE` - Middleware captures response (201, 80ms total)

## Performance Characteristics

- **Trace Overhead**: ~0.1-0.5ms per traced method (Source Generator approach)
- **Database Simulation**: 5-12ms delays to simulate real database latency
- **HTTP Middleware**: ~0.2ms overhead for request/response tracking
- **Total Request Time**: Depends on call chain depth and database operations

## Key Points

1. **Source Generator Magic**: All `[Trace]` methods automatically get instrumented versions (`MethodNameTraced`)
2. **Partial Classes Required**: Classes must be `partial` for the generator to extend them
3. **Async Support**: Full async/await support with proper Task<T> handling
4. **HTTP Context**: Middleware tracks request_id across entire request lifecycle
5. **Validation**: Business logic validation separate from data layer
6. **Error Handling**: Exceptions automatically logged with EXCEPTION events

## Testing the Example

### Test Complete CRUD Cycle
```bash
# 1. Create a product
curl -X POST http://localhost:5000/products \
  -H 'Content-Type: application/json' \
  -d '{"name": "Laptop", "price": 999.99, "stock": 10}'

# 2. List all products
curl http://localhost:5000/products

# 3. Get specific product
curl http://localhost:5000/products/0

# 4. Update product
curl -X PUT http://localhost:5000/products/0 \
  -H 'Content-Type: application/json' \
  -d '{"name": "Gaming Laptop", "price": 1299.99, "stock": 5}'

# 5. Delete product
curl -X DELETE http://localhost:5000/products/0

# 6. Verify deletion
curl http://localhost:5000/products/0  # Should return 404
```

### Test Validation
```bash
# Test invalid data
curl -X POST http://localhost:5000/products \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "price": -10, "stock": -5}'

# Expected: 400 Bad Request with error messages
```

### Test Exception Handling
```bash
# Test invalid ID
curl http://localhost:5000/products/999  # Should return 404
```

## Comparison with Python Example

| Feature | .NET AspNetCore | Python Flask |
|---------|----------------|--------------|
| Framework | ASP.NET Core Minimal API | Flask |
| Instrumentation | [Trace] Source Generator | @trace decorator |
| Database | ConcurrentDictionary | dict with Lock |
| Async | Full Task<T> support | async/await support |
| Validation | Service layer methods | Separate validation function |
| HTTP Context | Middleware with request_id | before_request/after_request |
| Performance | ~70ms for create | ~50ms for create |

## Next Steps

- See `../MinimalApiRealtime` for WebSocket real-time example
- See `../Microservice` for production architecture example
- See `../../docs/source-generators.md` for Source Generator details
