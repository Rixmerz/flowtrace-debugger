# FlowTrace Python Agent

🚧 **Coming Soon** - This agent is currently under development.

## Planned Features

- Function and method call tracing via `sys.settrace()` or decorator-based instrumentation
- Module prefix filtering (e.g., `myapp.`, `src.`)
- Framework support: Django, Flask, FastAPI
- Async/await support
- JSONL output format compatible with FlowTrace MCP Server

## Architecture Plan

### Approach 1: sys.settrace() (Preferred)
```python
import sys
import flowtrace

# Register tracer
sys.settrace(flowtrace.trace_calls)

# Your application code
def my_function():
    pass
```

### Approach 2: Decorator-based
```python
from flowtrace import trace

@trace
def my_function():
    pass
```

## Requirements

- Python 3.8+
- No external dependencies for core tracing
- Optional: `aiofiles` for async log writing

## Output Format

Compatible with FlowTrace JSONL format:
```json
{"timestamp":1635789012345,"event":"ENTER","thread":"MainThread","module":"myapp.services","function":"process_data","args":"[1, 2, 3]"}
{"timestamp":1635789012567,"event":"EXIT","thread":"MainThread","module":"myapp.services","function":"process_data","result":"42","durationMicros":222000,"durationMillis":222}
```

## Contributing

We're actively seeking Python developers to help build this agent!

**Skills needed:**
- Experience with Python introspection (`sys.settrace`, `inspect` module)
- Understanding of decorators and context managers
- Familiarity with async/await patterns
- Experience with Django, Flask, or FastAPI (optional)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for more information.

## Roadmap

- [ ] Core tracing engine (`sys.settrace()` implementation)
- [ ] Module prefix filtering
- [ ] JSONL log writer
- [ ] Configuration system (env variables, config file)
- [ ] Django middleware
- [ ] Flask extension
- [ ] FastAPI middleware
- [ ] Async/await support
- [ ] CLI tool integration
- [ ] Tests and documentation

## Questions?

Open an issue on GitHub: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger/issues)
