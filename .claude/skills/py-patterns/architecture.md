# Python Architecture Patterns

## Clean Architecture / Hexagonal
Dependencies point inward: Infrastructure -> Application -> Domain.
Hexagonal is a natural fit with Python's Protocol (implicit interface satisfaction).

```
src/my_project/
  modules/
    orders/                    # Bounded context
      domain/
        models.py              # Entities, aggregates
        value_objects.py       # Immutable value objects
        services.py            # Domain services
      application/
        use_cases.py           # Commands / use cases
        dtos.py                # Data Transfer Objects
      infrastructure/
        repositories.py        # Concrete implementations
        orm_models.py          # SQLAlchemy models
      controllers.py           # Input adapters (REST)
      bootstrap.py             # DI wiring for this module
    payments/                  # Another bounded context
  shared/                      # Cross-cutting concerns
    events.py
    exceptions.py
  main.py
```

**Pragmatic rule**: Not every module needs this complexity. Use flat structure for CRUD, hexagonal for complex domain logic.

## DDD Tactical Patterns

### Value Objects (immutable, equality by attributes)
```python
@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str

    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("Amount cannot be negative")

    def add(self, other: "Money") -> "Money":
        if self.currency != other.currency:
            raise ValueError("Cannot add different currencies")
        return Money(amount=self.amount + other.amount, currency=self.currency)
```

### Entities (identity by ID, mutable)
```python
@dataclass(eq=False)
class OrderLine:
    id: UUID = field(default_factory=uuid4)
    product_sku: str = ""
    quantity: int = 0

    def __eq__(self, other): return isinstance(other, OrderLine) and self.id == other.id
    def __hash__(self): return hash(self.id)
```

### Aggregate Root (entry point, protects invariants)
```python
@dataclass(eq=False)
class Order:
    id: UUID = field(default_factory=uuid4)
    lines: list[OrderLine] = field(default_factory=list)
    status: str = "draft"
    _events: list = field(default_factory=list, repr=False)

    def add_line(self, sku: str, qty: int, price: Money) -> None:
        if self.status != "draft":
            raise DomainError("Cannot modify confirmed order")
        self.lines.append(OrderLine(product_sku=sku, quantity=qty))

    def confirm(self) -> None:
        if not self.lines:
            raise DomainError("Cannot confirm empty order")
        self.status = "confirmed"
        self._events.append(OrderConfirmed(order_id=self.id))
```

## Repository Pattern + Service Layer
```python
from abc import ABC, abstractmethod

class OrderRepository(ABC):
    @abstractmethod
    def save(self, order: Order) -> None: ...
    @abstractmethod
    def get(self, order_id: UUID) -> Order | None: ...

class SQLAlchemyOrderRepository(OrderRepository):
    def __init__(self, session: Session):
        self._session = session
    def save(self, order: Order) -> None:
        self._session.merge(order)

class OrderService:
    def __init__(self, repo: OrderRepository, payment: PaymentGateway):
        self._repo = repo
        self._payment = payment

    def place_order(self, cmd: PlaceOrderCommand) -> OrderResult:
        order = Order(customer_id=cmd.customer_id)
        for item in cmd.items:
            order.add_line(item.sku, item.qty, item.price)
        order.confirm()
        self._repo.save(order)
        return OrderResult(order_id=order.id)
```

## Dependency Injection

### Small/medium: manual constructor injection
```python
def create_app() -> FastAPI:
    db_session = create_session(settings.database_url)
    order_repo = SQLAlchemyOrderRepository(db_session)
    payment = StripePaymentGateway(settings.stripe_key)
    order_service = OrderService(repo=order_repo, payment=payment)
    app = FastAPI()
    app.state.order_service = order_service
    return app
```

### Large: dependency-injector (~4.4K stars, Cython)
```python
from dependency_injector import containers, providers

class Container(containers.DeclarativeContainer):
    config = providers.Configuration()
    db_session = providers.Singleton(create_session, url=config.database_url)
    order_repo = providers.Factory(SQLAlchemyOrderRepository, session=db_session)
    order_service = providers.Factory(OrderService, repo=order_repo, payment=payment)
```

### FastAPI: built-in `Depends()`
Covers most web application DI needs without external libraries.

## Project Layout by Scale

### Small (scripts, CLIs, simple APIs)
```
my-project/
  my_project/
    __init__.py
    main.py
    models.py
    services.py
  tests/
  pyproject.toml
```

### Medium (APIs, web apps, pipelines) — use `src/` layout
```
my-project/
  src/my_project/
    api/         # routes, dependencies
    core/        # models, services, business logic
    db/          # repositories, session, migrations
    config.py
  tests/         # unit/, integration/
  pyproject.toml
```

### Large (DDD, microservices)
Use modular layout by bounded context (see Clean Architecture section above).

The `src/` layout prevents import confusion and ensures tests import the installed package.
