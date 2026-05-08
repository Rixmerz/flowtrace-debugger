# C# Architecture Patterns

## Clean Architecture with MediatR
Use when building enterprise applications with clear separation of concerns:
```
src/
  Domain/           <- Entities, Value Objects, Domain Events (no dependencies)
  Application/      <- Use Cases (Commands/Queries), Interfaces, DTOs
  Infrastructure/   <- EF Core, external services, file system
  WebApi/           <- Controllers/Minimal APIs, middleware, DI composition
```

```csharp
// Command (Application layer)
public record CreateOrderCommand(string CustomerId, List<OrderItemDto> Items) : IRequest<OrderId>;

// Handler (Application layer — depends only on domain interfaces)
public class CreateOrderHandler(IOrderRepository orders, IPaymentService payments)
    : IRequestHandler<CreateOrderCommand, OrderId>
{
    public async Task<OrderId> Handle(CreateOrderCommand cmd, CancellationToken ct)
    {
        var order = Order.Create(cmd.CustomerId, cmd.Items);
        await payments.Charge(order.Total, ct);
        await orders.Save(order, ct);
        return order.Id;
    }
}
```

## Vertical Slice with Carter
Use when you want feature-focused organization over layer-focused:
```
Features/
  CreateOrder/
    CreateOrderEndpoint.cs    <- HTTP handler
    CreateOrderCommand.cs     <- Request/Response types
    CreateOrderHandler.cs     <- Business logic
    CreateOrderValidator.cs   <- FluentValidation
  GetOrder/
    GetOrderEndpoint.cs
    GetOrderQuery.cs
```

```csharp
public class CreateOrderEndpoint : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/orders", async (CreateOrderCommand cmd, ISender sender) =>
        {
            var id = await sender.Send(cmd);
            return Results.Created($"/orders/{id}", new { id });
        });
    }
}
```
Rule: each slice is self-contained. Cross-cutting concerns go in pipeline behaviors.

## CQRS with MassTransit
Use when reads and writes have different performance or scaling needs:
```csharp
// Command side: writes through domain model
public class PlaceOrderConsumer(IOrderRepository repo) : IConsumer<PlaceOrder>
{
    public async Task Consume(ConsumeContext<PlaceOrder> ctx)
    {
        var order = Order.Create(ctx.Message);
        await repo.Save(order);
        await ctx.Publish(new OrderPlaced(order.Id));
    }
}

// Query side: reads from denormalized projection
public class OrderProjection(IReadDbContext db) : IConsumer<OrderPlaced>
{
    public async Task Consume(ConsumeContext<OrderPlaced> ctx)
    {
        await db.OrderViews.UpsertAsync(new OrderView
        {
            Id = ctx.Message.OrderId,
            Status = "placed",
            UpdatedAt = DateTime.UtcNow
        });
    }
}
```

## Microservices with Aspire
Use when orchestrating multiple .NET services in development and production:
```csharp
// AppHost/Program.cs — orchestration
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("db").AddDatabase("orders");
var redis = builder.AddRedis("cache");

builder.AddProject<Projects.OrderApi>("order-api")
    .WithReference(postgres)
    .WithReference(redis);

builder.AddProject<Projects.PaymentApi>("payment-api")
    .WithReference(redis);

builder.Build().Run();
```
Aspire provides service discovery, health checks, telemetry, and local orchestration out of the box.

## Minimal API Architecture (2025 Default)
Use for new microservices and simple APIs:
```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AppDbContext>();
builder.Services.AddScoped<IOrderService, OrderService>();

var app = builder.Build();

app.MapGet("/orders/{id}", async (Guid id, IOrderService svc) =>
    await svc.GetById(id) is { } order
        ? Results.Ok(order)
        : Results.NotFound());

app.MapPost("/orders", async (CreateOrderDto dto, IOrderService svc) =>
{
    var id = await svc.Create(dto);
    return Results.Created($"/orders/{id}", new { id });
});

app.Run();
```
