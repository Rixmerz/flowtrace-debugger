# Python Language Features

## Generators and Lazy Evaluation
```python
def read_large_file(path: str):
    with open(path, encoding="utf-8") as f:
        for line in f:
            yield line.strip()

# Generator pipelines (constant memory)
def filter_errors(lines):
    yield from (line for line in lines if "ERROR" in line)

def extract_timestamps(lines):
    for line in lines:
        yield line.split()[0]

timestamps = extract_timestamps(filter_errors(read_large_file("app.log")))
```

## Protocol Classes (Structural Subtyping)
```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class Closeable(Protocol):
    def close(self) -> None: ...

# No inheritance needed — duck typing verified statically
class DatabaseConnection:
    def close(self) -> None: ...

def cleanup(resource: Closeable) -> None:
    resource.close()

cleanup(DatabaseConnection())  # Works without inheriting Closeable
```

## Match Statements (3.10+)
```python
def describe(shape):
    match shape:
        case Point(x=0, y=0):
            return "origin"
        case Point(x, y) if x == y:
            return f"diagonal at {x}"
        case [Point() as p1, Point() as p2]:
            return f"line from {p1} to {p2}"
        case {"type": "circle", "radius": r}:
            return f"circle with radius {r}"
        case _:
            return "unknown"
```

## Walrus Operator (:=)
```python
if (n := len(data)) > 100:
    print(f"Processing {n} items")

while chunk := file.read(8192):
    process(chunk)

filtered = [y for x in data if (y := transform(x)) is not None]
```

## Dunder Methods (Data Model Protocol)
Key methods: `__init__`, `__repr__`, `__str__`, `__eq__`, `__hash__`, `__lt__/__gt__`, `__len__`, `__getitem__`, `__iter__`, `__next__`, `__enter__/__exit__`, `__call__`, `__getattr__/__setattr__`, `__format__`.

```python
@dataclass
class Temperature:
    celsius: float

    def __add__(self, other: "Temperature") -> "Temperature":
        return Temperature(self.celsius + other.celsius)

    def __format__(self, spec: str) -> str:
        if spec == "f":
            return f"{self.celsius * 9/5 + 32:.1f}F"
        return f"{self.celsius:.1f}C"
```

## The GIL and Free-Threaded Python
- GIL: only one thread executes Python bytecode at a time
- Threads useful only for I/O-bound (asyncio is better anyway)
- **Python 3.13**: Free-threaded experimental (`python3.13t`), ~40% single-thread penalty
- **Python 3.14**: Free-threaded officially supported (PEP 779), penalty reduced to ~5-10%
- **InterpreterPoolExecutor** (3.14): Multiple interpreters with separate GILs for real parallelism

## Async Patterns
```python
# TaskGroup (3.11+) — structured concurrency, replaces gather
async with asyncio.TaskGroup() as tg:
    task1 = tg.create_task(fetch(url1))
    task2 = tg.create_task(fetch(url2))
# Both complete or all cancelled on error

# Run blocking code in async context
result = await asyncio.to_thread(blocking_function, arg1)
```

## Metaclasses and __init_subclass__
Metaclasses control class creation (behind ABC, Enum, ORMs, Pydantic BaseModel).
**Rule**: If you're thinking of metaclasses, `__init_subclass__` or a class decorator is probably enough.

```python
class PluginBase:
    _registry: dict[str, type] = {}

    def __init_subclass__(cls, plugin_name: str = "", **kwargs):
        super().__init_subclass__(**kwargs)
        if plugin_name:
            PluginBase._registry[plugin_name] = cls

class JSONPlugin(PluginBase, plugin_name="json"): ...
class XMLPlugin(PluginBase, plugin_name="xml"): ...
```

## Performance Optimization Tools
- **pprof/cProfile**: Profile before optimizing
- **Mypyc**: Compile typed Python to C extensions (3-5x speedup)
- **Cython 3.0**: C extensions from Python-like syntax
- **Numba**: JIT for numeric code
- **PyPy**: Alternative interpreter for long-running programs
- CPython JIT (3.13+ experimental): Gradual native compilation
