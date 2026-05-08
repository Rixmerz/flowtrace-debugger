---
paths: ["**/*.py", "**/*.pyw"]
---

# Python Rules

> Always apply these rules when writing or reviewing Python code.

## DO
- Use type hints on all function signatures
- Use `dataclass(frozen=True, slots=True)` for value objects
- Use Pydantic at system boundaries, dataclasses internally
- Use `pathlib.Path` instead of `os.path`
- Use f-strings for string formatting
- Use `match`/`case` for structural pattern matching (3.10+)
- Use built-in generics (`list[str]`, not `List[str]`) (3.9+)
- Use `X | Y` union syntax (3.10+), not `Union[X, Y]`
- Use `asyncio.TaskGroup` instead of `asyncio.gather` (3.11+)
- Use `functools.cache`/`lru_cache` for pure functions with repeated inputs
- Use `asyncio.to_thread()` for blocking calls in async code
- Specify `encoding="utf-8"` when opening files
- Use `subprocess.run(["cmd", "arg"], check=True)` (no `shell=True`)
- Add context to errors: `raise ValueError(f"Invalid user {user_id}") from e`
- Use `Enum` for finite option sets instead of magic strings
- Configure `ruff check` + `ruff format` + `mypy --strict` in CI

## DON'T
- Don't use `import *` in production code
- Don't catch bare `Exception` without re-raising or logging
- Don't use mutable default arguments (`def f(items=[])`)
- Don't use `type()` for type checks — use `isinstance()` or Protocol
- Don't use `os.system()` or `subprocess` with `shell=True`
- Don't ignore the GIL — use `asyncio.to_thread()` for blocking in async
- Don't mix sync and async without `to_thread()`
- Don't use strings for structured data (dates, money, IDs) — use proper types
- Don't create metaclasses when `__init_subclass__` or decorators suffice
- Don't use `logrus`-style unstructured logging — use structlog with JSON
- Don't use pip for new projects — use uv
- Don't use Flake8+Black+isort — use Ruff (single tool)
