# Python Frameworks Reference

## Web & API

| Framework | Adoption | Key Trait | When to Use |
|-----------|----------|-----------|-------------|
| **FastAPI** | 38% | ASGI, Pydantic, auto OpenAPI, async native | APIs, microservices, ML serving (default 2025) |
| **Django** | 35% | Batteries-included, ORM, admin, auth | Full-stack, enterprise, CMS |
| **Flask** | 34% | WSGI micro-framework, full control | Prototypes, dashboards, internal tools |
| **Litestar** | — | Built-in DI, opinionated structure | Alternative to FastAPI with more structure |
| **Starlette** | — | Raw ASGI, minimal overhead | High-perf microservices where FastAPI is too heavy |
| **Sanic** | ~19K stars | Low latency, async | Chat apps, IoT |

Production pattern: FastAPI + Uvicorn + PostgreSQL async (SQLAlchemy 2.0) + Redis + Nginx + Docker/K8s

## Database & ORM

| Library | Approach | Best For |
|---------|----------|----------|
| **SQLAlchemy 2.0** | Two-layer (Core + ORM), type hints, async, Cython | Default for any project |
| **SQLModel** | Pydantic + SQLAlchemy unified model | FastAPI projects (same author) |
| **Tortoise ORM** | Async-first, Django-like syntax | Async PG with asyncpg |
| **Peewee** | Lightweight ORM | Small projects, scripts |
| **Alembic** | Schema migrations | Standard for SQLAlchemy migrations |

## Data Science & ML

| Library | Role | Trend 2025 |
|---------|------|------------|
| **pandas** 2.2 | Tabular data analysis | Dominant, Polars gaining |
| **Polars** | High-perf DataFrames (Rust) | **5-10x faster** than pandas, explosive growth |
| **NumPy** 2.x | Foundational numeric computation | Essential |
| **scikit-learn** 1.5 | Classical ML | Standard, now supports Polars |
| **PyTorch** 2.5 | Deep learning | **Dominant in research and production** |
| **TensorFlow** 2.17 | ML production/edge | Declining vs PyTorch |
| **JAX** | HPC numeric computation (Google) | Cutting-edge research |
| **XGBoost/LightGBM** | Gradient boosting | Standard for tabular data |

## AI/LLM Ecosystem

| Library | Role | Notes |
|---------|------|-------|
| **CrewAI** | Multi-agent framework | 44K+ stars, specialized roles |
| **LangGraph** | State graph agents | Complex agent workflows |
| **Pydantic AI** | Type-safe AI framework | MCP support, from Pydantic team |
| **vLLM** | LLM serving | PagedAttention, **24x throughput** vs HF |
| **Instructor** | Structured outputs | 3M+/month, Pydantic extraction |
| **MCP SDK** | Tool/data protocol | Anthropic standard, FastMCP 2.0 |
| **MLflow** | MLOps | 23K+ stars, dominant |

## Testing

- **pytest** 8.x (53% adoption): Fixtures, 1000+ plugins, parametrize
- **Hypothesis**: Property-based testing, auto-generated inputs
- **Playwright** (Microsoft): E2E replacing Selenium
- **factory_boy**: Model fixtures. **Faker**: Realistic test data
- **respx**: httpx mocking. **coverage.py**: Coverage metrics
- **testcontainers-python**: Real databases in Docker for integration tests

## CLI & TUI

- **Typer**: Modern CLI (type hints, same author as FastAPI)
- **Click**: Granular control CLI
- **Rich**: Beautiful terminal output
- **Textual**: Interactive TUIs

## Async & Concurrency

- **asyncio** (stdlib): Default event loop
- **httpx**: Sync+async HTTP client, HTTP/2
- **aiohttp**: Max performance async-pure
- **uvloop**: Cython event loop, 2-4x faster
- **anyio**: asyncio/trio compatibility

## Task Queues

| Library | Key Trait | Best For |
|---------|-----------|----------|
| **Celery** 5.5 | Enterprise scale | Large distributed systems |
| **Dramatiq** | Simpler, safer (ack on complete) | Modern alternative to Celery |
| **arq** | Native asyncio | Async-first projects |
| **Taskiq** | Async emerging | New async projects |

## Validation

| Library | Speed | Best For |
|---------|-------|----------|
| **Pydantic v2** | Rust core, 30% adoption | API boundaries, config, external data |
| **attrs+cattrs** | Lightweight | Flexible internal models |
| **msgspec** | Ultra-fast | Performance-critical serialization |

## Logging

- **structlog**: JSON structured logging, contextvars, recommended for production
- **logging** (stdlib): Built-in, adequate for simple needs
- JSON in production, colorized console in development

## Security

- **cryptography**: Cryptographic primitives
- **PyJWT**: JWT tokens
- **pwdlib**: Modern password hashing (replaces unmaintained passlib)
- **Bandit**: Static security analysis (always in CI/CD)
