# Python Best Practices (2024-2025)

## Type Hints (88% of Python devs use them)
```python
# Built-in generics (3.9+), not typing.List/Dict
def process(items: list[str]) -> dict[str, int]: ...

# Union syntax (3.10+)
def find_user(id: int) -> User | None: ...

# Type parameter syntax (3.12+)
type Vector[T] = list[T]
def first[T](items: list[T]) -> T: ...

# Protocol for structural subtyping (duck typing + type safety)
class Renderable(Protocol):
    def render(self) -> str: ...
```

Use **mypy --strict** or **Pyright** in CI. **ty** (Astral, beta) is 10-100x faster.

## Pydantic at Boundaries, Dataclasses Inside
```python
# External boundary: Pydantic validates and coerces
class CreateUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str
    age: int = Field(gt=0, lt=150)

# Internal domain: lightweight dataclass
@dataclass(frozen=True, slots=True)
class UserId:
    value: UUID
```

## Structured Logging with structlog
```python
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)
logger = structlog.get_logger()
logger.info("order_placed", order_id="abc-123", total=99.99)
```
JSON in production, colorized console in dev. Use `contextvars` for per-request context.

## Configuration with pydantic-settings
```python
class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://localhost:6379"
    debug: bool = False
    model_config = {"env_file": ".env", "env_prefix": "APP_"}

settings = Settings()  # Validates at startup; fails fast
```

## Package Management: uv is the new standard
```bash
uv init my-project && cd my-project
uv add fastapi sqlalchemy pydantic
uv add --dev pytest ruff mypy
uv python install 3.13
uvx ruff check .
uv lock && uv sync
```
80-115x faster than pip. Replaces pip, pip-tools, pipx, pyenv, virtualenv, poetry.

## Testing
```python
# Composable fixtures in conftest.py
@pytest.fixture
def order_repo():
    return InMemoryOrderRepository()

@pytest.fixture
def order_service(order_repo):
    payment = AsyncMock(spec=PaymentGateway)
    payment.charge.return_value = True
    return OrderService(repo=order_repo, payment=payment)

# Parametrize for multiple cases
@pytest.mark.parametrize("qty,expected", [(1, False), (100, False), (101, True)])
def test_bulk_discount(qty: int, expected: bool):
    assert has_bulk_discount(qty) == expected

# Async integration test
@pytest.mark.anyio
async def test_create_order(app: FastAPI):
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/orders", json={"items": [...]})
        assert response.status_code == 201
```

Prefer DI over mocking: pass `InMemoryRepository` instead of `patch`. Use `autospec=True` when mocking.

## Tooling (2025)
- **Ruff**: Linter + formatter, 10-100x faster than Flake8, replaces Flake8+Black+isort+pyupgrade
- **uv**: Package manager, 80-115x faster than pip
- **ty**: Type checker (Astral, beta), 10-100x faster than mypy
- **mypy**: Type checker (67% adoption), `--strict` in CI
- **pytest**: Testing (53% adoption)
- **structlog**: Structured logging
- **Bandit**: Security static analysis (always in CI)

CI pipeline: `ruff check . && ruff format --check . && mypy --strict . && pytest`
