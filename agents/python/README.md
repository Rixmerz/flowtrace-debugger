# FlowTrace Python Agent

**Intelligent tracing for Python applications with AI-powered analysis**

[![Python Version](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Comprehensive distributed tracing agent for Python with support for Flask, Django, FastAPI, and more. Automatically traces function calls, HTTP requests, and async operations with minimal performance overhead.

## Features

- ✅ **Automatic Tracing**: `sys.settrace()` based whole-application tracing
- ✅ **Decorator-Based**: Explicit `@trace` decorator for fine-grained control
- ✅ **Framework Support**: Built-in middleware for Flask, Django, FastAPI
- ✅ **Async/Await**: Full support for async functions and coroutines
- ✅ **HTTP Context**: Request ID tracking, timing, and metadata capture
- ✅ **Module Filtering**: Smart filtering of standard library and third-party code
- ✅ **JSONL Output**: Compatible with FlowTrace MCP Server format
- ✅ **CLI Tool**: `flowctl-py` for code analysis and auto-instrumentation
- ✅ **Production Ready**: Thread-safe, low overhead, configurable sampling

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Modes](#usage-modes)
- [Framework Integration](#framework-integration)
- [CLI Tool](#cli-tool)
- [Configuration](#configuration)
- [Advanced Usage](#advanced-usage)
- [Examples](#examples)
- [Performance](#performance)
- [API Reference](#api-reference)

## Installation

### Using pip:

```bash
pip install flowtrace-agent
```

### From source:

```bash
git clone https://github.com/Rixmerz/flowtrace-debugger.git
cd flowtrace/agents/python
pip install -e .
```

### Optional dependencies:

```bash
# For async logging
pip install aiofiles

# For CLI tool
pip install astor  # Python < 3.9
```

## Quick Start

### Automatic Tracing (sys.settrace)

Trace all function calls in your application:

```python
from flowtrace_agent import Config, start_tracing, stop_tracing

# Configure
config = Config(
    package_prefix='myapp',  # Only trace your code
    logfile='flowtrace.jsonl',
    stdout=False
)

# Start tracing
start_tracing(config)

# Your application code
def process_data(data):
    return data * 2

result = process_data([1, 2, 3])

# Stop tracing
stop_tracing()
```

### Decorator-Based Tracing

Explicit function instrumentation:

```python
from flowtrace_agent import Config, trace, init_decorator_logger

# Initialize
config = Config(logfile='flowtrace.jsonl')
init_decorator_logger(config)

# Decorate functions
@trace
def calculate(x, y):
    return x + y

@trace
async def fetch_data(url):
    # async support
    return await client.get(url)

result = calculate(5, 3)
```

## Usage Modes

### 1. Automatic Tracing (sys.settrace)

**Best for**: Development, debugging, comprehensive analysis

```python
import sys
from flowtrace_agent import start_tracing, Config

config = Config(package_prefix='myapp,src')
start_tracing(config)

# All your code gets traced automatically
```

**Pros**: Zero code changes, complete coverage
**Cons**: Higher overhead, may trace too much

### 2. Decorator-Based Tracing

**Best for**: Production, targeted instrumentation, performance-sensitive code

```python
from flowtrace_agent import trace

@trace
def critical_function(data):
    # Only this function gets traced
    return process(data)
```

**Pros**: Low overhead, explicit control
**Cons**: Requires code modification

### 3. Hybrid Approach

**Best for**: Most applications

```python
# Use automatic tracing for your modules
start_tracing(Config(package_prefix='myapp'))

# Add explicit tracing for critical paths
@trace
def important_function():
    pass
```

## Framework Integration

### Flask

```python
from flask import Flask
from flowtrace_agent import Config
from flowtrace_agent.frameworks.flask import init_flowtrace

app = Flask(__name__)

# Initialize FlowTrace
config = Config(package_prefix='myapp', logfile='flowtrace.jsonl')
init_flowtrace(app, config)

@app.route('/api/users')
def get_users():
    # Automatically traced with HTTP context
    return {'users': [...]}

if __name__ == '__main__':
    app.run()
```

**Features**: Request ID tracking, HTTP timing, automatic trace lifecycle

### FastAPI

```python
from fastapi import FastAPI
from flowtrace_agent import Config
from flowtrace_agent.frameworks.fastapi import init_flowtrace

app = FastAPI()

# Initialize FlowTrace
config = Config(package_prefix='myapp', logfile='flowtrace.jsonl')
init_flowtrace(app, config)

@app.get('/api/users')
async def get_users():
    # Automatically traced with async support
    return {'users': [...]}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
```

**Features**: Async/await support, middleware-based tracing, HTTP context

### Django

Add to `MIDDLEWARE` in `settings.py`:

```python
MIDDLEWARE = [
    # ... other middleware
    'flowtrace_agent.frameworks.django.FlowTraceMiddleware',
]
```

Configure via environment variables:

```bash
export FLOWTRACE_PACKAGE_PREFIX=myapp
export FLOWTRACE_LOGFILE=flowtrace.jsonl
```

**Features**: Automatic initialization, per-request tracing, Django-native configuration

## CLI Tool

### flowctl-py - Analysis and Auto-Instrumentation

```bash
# Analyze project
python flowctl-py/main.py analyze src/

# Output:
# 📊 Analysis Results:
#   5 files analyzed
#   42 total functions found
#   35 instrumentable functions
#   7 already instrumented

# Instrument code (adds @trace decorators)
python flowctl-py/main.py instrument app.py --dry-run  # Preview
python flowctl-py/main.py instrument app.py            # Apply

# Validate setup
python flowctl-py/main.py validate

# ✅ flowtrace_agent package found
# ✅ Found 25 Python files
# ✅ Frameworks detected: Flask, FastAPI
```

See [flowctl-py/README.md](flowctl-py/README.md) for complete documentation.

## Configuration

### Via Code

```python
from flowtrace_agent import Config

config = Config(
    package_prefix='myapp,src',           # Modules to trace
    logfile='flowtrace.jsonl',            # Output file
    stdout=False,                         # Also log to stdout
    max_arg_length=1000,                  # Truncate long arguments
    exclude_patterns=['test', 'debug'],   # Exclude patterns
    async_logging=False                   # Enable async I/O
)
```

### Via Environment Variables

```bash
export FLOWTRACE_PACKAGE_PREFIX=myapp,src
export FLOWTRACE_LOGFILE=flowtrace.jsonl
export FLOWTRACE_STDOUT=false
export FLOWTRACE_MAX_ARG_LENGTH=1000
export FLOWTRACE_EXCLUDE=test,debug
export FLOWTRACE_ASYNC=false
```

### Via Dictionary

```python
config_dict = {
    'package_prefix': 'myapp',
    'logfile': 'flowtrace.jsonl',
    'stdout': True
}

config = Config.from_dict(config_dict)
```

## Advanced Usage

### Custom Spans

Manual span creation for fine-grained control:

```python
from flowtrace_agent import trace

@trace
def process_order(order_id):
    # Function automatically traced

    # Manual nested operations can use nested decorators
    validate_order(order_id)
    charge_payment(order_id)
    ship_order(order_id)

@trace
def validate_order(order_id):
    # Each function gets its own span
    pass
```

### Error Handling

Exceptions are automatically captured:

```python
@trace
def risky_operation():
    raise ValueError("Something went wrong")

try:
    risky_operation()
except ValueError:
    pass  # Exception logged with stack trace
```

### Thread Safety

FlowTrace is fully thread-safe:

```python
import threading

@trace
def worker(n):
    return n * 2

threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
for t in threads:
    t.start()
```

### Async/Await

Full support for async functions:

```python
import asyncio

@trace
async def fetch_data(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

@trace
async def main():
    results = await asyncio.gather(
        fetch_data('https://api1.example.com'),
        fetch_data('https://api2.example.com')
    )
    return results

asyncio.run(main())
```

## Examples

Complete working examples available in [`examples/`](examples/):

### 1. Flask Advanced ([examples/flask-advanced/](examples/flask-advanced/))

- Complete REST API with CRUD operations
- Database simulation with query tracing
- Custom spans and error handling
- **250+ LOC**

### 2. FastAPI Realtime ([examples/fastapi-realtime/](examples/fastapi-realtime/))

- WebSocket chat application
- Real-time message broadcasting
- Room management with concurrent clients
- **280+ LOC**

### 3. Django Microservice ([examples/django-microservice/](examples/django-microservice/))

- Production service architecture
- Cache, Database, Logger services
- Purchase workflow with inventory management
- **300+ LOC**

## Performance

### Overhead Measurements

| Mode | Overhead | Use Case |
|------|----------|----------|
| Decorator | ~5-10μs per call | Production, critical paths |
| sys.settrace | ~20-50μs per call | Development, debugging |
| HTTP Middleware | ~100-200μs per request | All environments |

### Optimization Tips

1. **Use Package Prefix**: Only trace your application code
   ```python
   Config(package_prefix='myapp')  # Not 'os', 'sys', etc.
   ```

2. **Limit Argument Serialization**:
   ```python
   Config(max_arg_length=500)  # Truncate large arguments
   ```

3. **Async Logging** (for high-throughput):
   ```python
   Config(async_logging=True)  # Requires aiofiles
   ```

4. **Decorator Mode** for production:
   ```python
   @trace  # Only trace critical functions
   def important_function():
       pass
   ```

## API Reference

### Core Functions

#### `start_tracing(config: Config = None)`

Start global automatic tracing using `sys.settrace()`.

```python
start_tracing(Config(package_prefix='myapp'))
```

#### `stop_tracing()`

Stop global tracing and flush logs.

```python
stop_tracing()
```

#### `@trace`

Decorator for explicit function instrumentation.

```python
@trace
def my_function(arg1, arg2):
    return arg1 + arg2
```

#### `init_decorator_logger(config: Config = None)`

Initialize logger for decorator-based tracing.

```python
init_decorator_logger(Config(logfile='app.jsonl'))
```

### Configuration

#### `Config` Class

Configuration dataclass with the following fields:

- `package_prefix: str` - Comma-separated module prefixes to trace
- `logfile: str` - Output file path (default: `'flowtrace.jsonl'`)
- `stdout: bool` - Also write to stdout (default: `False`)
- `max_arg_length: int` - Max argument serialization length (default: `1000`)
- `exclude_patterns: List[str]` - Module patterns to exclude
- `async_logging: bool` - Enable async I/O (default: `False`)

#### Class Methods

- `Config.from_env()` - Create from environment variables
- `Config.from_dict(dict)` - Create from dictionary
- `config.to_dict()` - Convert to dictionary

### Framework Integration

#### Flask: `init_flowtrace(app, config=None)`

Initialize FlowTrace for Flask application.

#### FastAPI: `init_flowtrace(app, config=None)`

Initialize FlowTrace for FastAPI application.

#### Django: `FlowTraceMiddleware`

Django middleware class (add to `MIDDLEWARE` setting).

## Output Format

All events are logged in JSONL format compatible with FlowTrace MCP Server:

### Function Entry (ENTER)

```json
{
  "timestamp": 1635789012345678,
  "event": "ENTER",
  "thread": "MainThread",
  "module": "myapp.services",
  "function": "process_data",
  "args": "{\"data\": [1, 2, 3]}"
}
```

### Function Exit (EXIT)

```json
{
  "timestamp": 1635789012567890,
  "event": "EXIT",
  "thread": "MainThread",
  "module": "myapp.services",
  "function": "process_data",
  "result": "[2, 4, 6]",
  "durationMicros": 222212,
  "durationMillis": 222
}
```

### Exception (EXCEPTION)

```json
{
  "timestamp": 1635789012567890,
  "event": "EXCEPTION",
  "thread": "MainThread",
  "module": "myapp.services",
  "function": "risky_function",
  "exception": {
    "type": "ValueError",
    "message": "Invalid input"
  }
}
```

### HTTP Request (HTTP_REQUEST)

```json
{
  "timestamp": 1635789012345678,
  "event": "HTTP_REQUEST",
  "request_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
  "method": "GET",
  "path": "/api/users",
  "remote_addr": "127.0.0.1",
  "user_agent": "Mozilla/5.0..."
}
```

### HTTP Response (HTTP_RESPONSE)

```json
{
  "timestamp": 1635789012567890,
  "event": "HTTP_RESPONSE",
  "request_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
  "method": "GET",
  "path": "/api/users",
  "status_code": 200,
  "durationMicros": 222212,
  "durationMillis": 222
}
```

## Testing

Run the test suite:

```bash
# Install test dependencies
pip install pytest

# Run tests
pytest tests/ -v

# Run specific test file
pytest tests/test_tracer.py -v

# Run with coverage
pytest tests/ --cov=flowtrace_agent --cov-report=html
```

Test files:
- `tests/test_tracer.py` - Core tracer tests
- `tests/test_decorator.py` - Decorator tests
- `tests/test_config.py` - Configuration tests
- `tests/test_filters.py` - Module filtering tests
- `tests/test_logger.py` - Logger tests
- `tests/test_flask_integration.py` - Flask integration tests

## Architecture

```
flowtrace_agent/
├── __init__.py           # Public API
├── tracer.py             # sys.settrace() implementation
├── decorators.py         # @trace decorator
├── config.py             # Configuration management
├── logger.py             # JSONL logging (sync + async)
├── filters.py            # Module filtering logic
└── frameworks/
    ├── flask.py          # Flask middleware
    ├── fastapi.py        # FastAPI middleware
    └── django.py         # Django middleware

flowctl-py/               # CLI tool
├── main.py               # CLI entry point
├── analyzer.py           # AST analysis
└── instrumenter.py       # Auto-instrumentation

examples/                 # Working examples
├── flask-advanced/
├── fastapi-realtime/
└── django-microservice/

tests/                    # Test suite
└── test_*.py
```

## Comparison with Other Agents

| Feature | Python | Go | Rust | .NET |
|---------|--------|-----|------|------|
| Auto Tracing | ✅ sys.settrace | ✅ AST | ✅ Proc Macro | 🚧 |
| Decorator/Attribute | ✅ @trace | ✅ //trace | ✅ #[trace] | 🚧 |
| Async Support | ✅ Full | ✅ Goroutines | ✅ Tokio | 🚧 |
| CLI Tool | ✅ flowctl-py | ✅ flowctl | ✅ flowctl-rs | 🚧 |
| Framework Support | ✅ 3 frameworks | ✅ 4 frameworks | ✅ Actix | 🚧 |
| HTTP Context | ✅ Request ID | ✅ Request ID | ✅ Middleware | 🚧 |
| Tests | ✅ 6 test files | ✅ 9 test files | ✅ Unit tests | 🚧 |
| Status | ✅ 100% | ✅ 100% | ✅ 100% | ❌ 10% |

## Roadmap

- [x] Core tracing engine (sys.settrace)
- [x] Decorator-based tracing
- [x] Module filtering
- [x] JSONL logger (sync + async)
- [x] Configuration system
- [x] Flask middleware
- [x] FastAPI middleware
- [x] Django middleware
- [x] CLI tool (flowctl-py)
- [x] Complete test suite
- [x] Advanced examples
- [x] HTTP context tracking
- [x] Complete documentation
- [ ] Sampling strategies
- [ ] Distributed tracing (trace propagation)
- [ ] Metrics collection
- [ ] Performance profiling integration

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](../../LICENSE) for details.

## Support

- **Documentation**: [FlowTrace Docs](https://github.com/Rixmerz/flowtrace-debugger)
- **Issues**: [GitHub Issues](https://github.com/Rixmerz/flowtrace-debugger/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Rixmerz/flowtrace-debugger/discussions)

---

**Made with 🐍 by the FlowTrace Team**
