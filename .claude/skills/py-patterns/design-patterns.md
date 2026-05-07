# Python Design Patterns

## Creational

### Singleton: use a module (pythonic)
```python
# Modules are natural singletons in Python
# database.py
_connection = None

def get_connection():
    global _connection
    if _connection is None:
        _connection = create_connection()
    return _connection
```
Avoid metaclass singletons — overengineering in Python.

### Factory: dict of callables
```python
from typing import Protocol

class Serializer(Protocol):
    def serialize(self, data: dict) -> str: ...

_serializers: dict[str, type[Serializer]] = {
    "json": JSONSerializer,
    "xml": XMLSerializer,
}

def create_serializer(format: str, **kwargs) -> Serializer:
    if format not in _serializers:
        raise ValueError(f"Unknown format: {format}")
    return _serializers[format](**kwargs)
```

### Builder: dataclasses + fluent methods
```python
@dataclass
class QueryBuilder:
    _table: str = ""
    _conditions: list[str] = field(default_factory=list)
    _limit: int | None = None

    def table(self, name: str) -> "QueryBuilder":
        self._table = name
        return self

    def where(self, condition: str) -> "QueryBuilder":
        self._conditions.append(condition)
        return self

    def build(self) -> str:
        query = f"SELECT * FROM {self._table}"
        if self._conditions:
            query += " WHERE " + " AND ".join(self._conditions)
        if self._limit:
            query += f" LIMIT {self._limit}"
        return query
```

## Structural

### Decorator (first-class in Python)
```python
import functools
from typing import Callable, TypeVar, ParamSpec

P = ParamSpec("P")
R = TypeVar("R")

def retry(max_attempts: int = 3, delay: float = 1.0):
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == max_attempts:
                        raise
                    time.sleep(delay * attempt)
            raise RuntimeError("Unreachable")
        return wrapper
    return decorator
```

### Adapter: composition
```python
class PaymentGateway(Protocol):
    def charge(self, amount: Decimal, currency: str, order_id: str) -> bool: ...

class PaymentAdapter:
    def __init__(self, sdk: ExternalPaymentSDK):
        self._sdk = sdk

    def charge(self, amount: Decimal, currency: str, order_id: str) -> bool:
        result = self._sdk.make_payment(
            amt_cents=int(amount * 100), curr=currency.upper(), ref=order_id
        )
        return result["status"] == "success"
```

## Behavioral

### Strategy: functions as first-class citizens
```python
type PricingStrategy = Callable[[Decimal, int], Decimal]

def regular_pricing(price: Decimal, quantity: int) -> Decimal:
    return price * quantity

def bulk_pricing(price: Decimal, quantity: int) -> Decimal:
    discount = Decimal("0.1") if quantity > 100 else Decimal("0")
    return price * quantity * (1 - discount)

@dataclass
class Order:
    items: list[tuple[Decimal, int]]
    pricing: PricingStrategy = regular_pricing

    @property
    def total(self) -> Decimal:
        return sum(self.pricing(price, qty) for price, qty in self.items)
```

### Observer: typed EventBus
```python
type EventHandler[T] = Callable[[T], None]

@dataclass
class EventBus:
    _handlers: dict[type, list[Callable]] = field(default_factory=dict)

    def subscribe[T](self, event_type: type[T], handler: EventHandler[T]) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    def publish[T](self, event: T) -> None:
        for handler in self._handlers.get(type(event), []):
            handler(event)
```

## Python-Specific Patterns

### Context Managers
```python
from contextlib import contextmanager, asynccontextmanager

@contextmanager
def timer(label: str):
    start = time.perf_counter()
    yield
    print(f"{label}: {time.perf_counter() - start:.3f}s")

@asynccontextmanager
async def get_db_session():
    session = AsyncSession(engine)
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
```

### Descriptors
```python
class Validated:
    def __init__(self, validator: Callable, error_msg: str):
        self._validator = validator
        self._error_msg = error_msg

    def __set_name__(self, owner, name):
        self._name = f"_{name}"

    def __get__(self, obj, objtype=None):
        return getattr(obj, self._name, None) if obj else self

    def __set__(self, obj, value):
        if not self._validator(value):
            raise ValueError(self._error_msg)
        setattr(obj, self._name, value)

class Product:
    name = Validated(lambda v: isinstance(v, str) and len(v) > 0, "Name required")
    price = Validated(lambda v: isinstance(v, (int, float)) and v > 0, "Price must be positive")
```
