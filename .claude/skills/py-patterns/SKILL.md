---
name: py-patterns
description: Python architecture reference - frameworks, design patterns, type system, async patterns, and production best practices for 2024-2025. Use when making architectural decisions, reviewing Python code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Python Architecture Reference (2024-2025)

Comprehensive reference for Python architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (pythonic creational, structural, behavioral), see [design-patterns.md](design-patterns.md)
- For architecture patterns (Clean, Hexagonal, DDD, DI, project layout), see [architecture.md](architecture.md)
- For best practices (type hints, testing, tooling, DO/DON'T), see [best-practices.md](best-practices.md)
- For language features (generators, protocols, match, GIL, decorators), see [language-features.md](language-features.md)

## Decision Framework

1. **Web framework**: API-only -> FastAPI. Full-stack/admin -> Django. Minimal/scripts -> Flask. High-perf ASGI -> Litestar/Starlette
2. **Database**: Default -> SQLAlchemy 2.0. FastAPI simple -> SQLModel. Async PG -> Tortoise. Lightweight -> Peewee
3. **Validation**: API boundaries -> Pydantic v2. Internal domain -> dataclasses. Ultra-fast serialization -> msgspec
4. **Data processing**: Default -> pandas. Large/fast -> Polars. Numeric -> NumPy
5. **Task queue**: Enterprise -> Celery. Simple/modern -> Dramatiq. Async-native -> arq
6. **Package mgmt**: New projects -> uv. Existing -> Poetry. Legacy -> pip+venv
7. **Testing**: Always pytest. Property-based -> Hypothesis. E2E -> Playwright

## Modern Idiomatic Stack (2025)

**Replacing:** Flask + GORM + logrus + pip + Flake8 + Black + isort
**With:** FastAPI + Pydantic v2 + SQLAlchemy 2.0 + uv + Ruff + structlog

## Python Evolution

| Version | Key Features |
|---------|-------------|
| 3.10 | Pattern matching (`match`/`case`), `X \| Y` union syntax |
| 3.11 | ~25% faster, `ExceptionGroup`, `TaskGroup`, `tomllib` |
| 3.12 | Type parameter syntax (`type X[T]`), f-string improvements |
| 3.13 | Free-threaded (experimental), JIT (experimental), new REPL, iOS/Android |
| 3.14 | t-strings, deferred annotations, `InterpreterPoolExecutor`, free-threaded official, tail-call interp |

## Python in Production

| Company | Scale |
|---------|-------|
| **Instagram** | 1.2B monthly users on Django |
| **Netflix** | Central Alert Gateway, Dispatch (FastAPI), security automation |
| **Spotify** | Backend, data analysis, ML, Luigi pipelines (~6K processes) |
| **Google** | YouTube backend, search algorithms, Gmail |
| **JPMorgan** | Athena platform (pricing, risk management) |
| **Uber** | Ludwig ML framework (FastAPI REST server) |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
