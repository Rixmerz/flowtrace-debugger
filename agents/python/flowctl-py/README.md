# flowctl-py

**CLI tool for FlowTrace Python agent** - Analyze and instrument Python code for automatic tracing.

## Features

- 🔍 **Analyze** Python projects to find instrumentable functions
- 🔧 **Instrument** code automatically with `@trace` decorators
- ✅ **Validate** FlowTrace setup in your project
- 📊 **Statistics** on functions, LOC, and instrumentation coverage

## Installation

### From source:

```bash
cd flowctl-py
pip install -e .
```

### Requirements:

```bash
pip install astor  # For Python < 3.9
```

### Verify installation:

```bash
python main.py version
```

## Usage

### Analyze Project

Analyze a Python file or directory to find instrumentable functions:

```bash
# Analyze single file
python main.py analyze app.py

# Analyze entire project
python main.py analyze src/

# Show detailed statistics
python main.py analyze src/ --verbose
```

**Output:**
```
🔍 Analyzing Python project...

📊 Analysis Results:

  5 files analyzed
  42 total functions found
  35 instrumentable functions
  7 already instrumented
  1250 lines of code

💡 Tip: Run 'flowctl-py instrument <file>' to add tracing
```

### Instrument Code

Add `@trace` decorators to instrumentable functions:

```bash
# Dry run - see what would be instrumented
python main.py instrument app.py --dry-run

# Instrument file (creates backup by default)
python main.py instrument app.py

# Instrument without backup
python main.py instrument app.py --no-backup
```

**Output:**
```
🔧 Instrumenting Python code...

✅ Instrumentation complete!

  8 functions instrumented
  Backup created: app.py.bak

💡 Next steps:
  1. Configure FlowTrace (see README)
  2. Run your application
  3. Check flowtrace.jsonl for traces
```

### Validate Setup

Check if FlowTrace is properly configured in your project:

```bash
python main.py validate
```

**Output:**
```
🔍 Validating FlowTrace setup...

✅ flowtrace_agent package found
   Version: 1.0.0
✅ Found 25 Python files
✅ Project configuration found
✅ Frameworks detected: Flask, FastAPI

✅ FlowTrace setup looks good!
```

## Commands

### `analyze <path>`

Analyze Python code for instrumentable functions.

**Options:**
- `-v, --verbose`: Show detailed statistics

### `instrument <path>`

Add `@trace` decorators to functions.

**Options:**
- `-n, --dry-run`: Preview changes without modifying files
- `-b, --backup`: Create backup before modifying (default: true)
- `--no-backup`: Do not create backup

### `validate`

Validate FlowTrace setup in current project.

### `version`

Show version information.

## Example Workflow

```bash
# 1. Create new Python project
mkdir my-app
cd my-app

# 2. Install FlowTrace
pip install flowtrace-agent

# 3. Analyze your code
python /path/to/flowctl-py/main.py analyze .

# 4. Preview instrumentation
python /path/to/flowctl-py/main.py instrument app.py --dry-run

# 5. Instrument your code
python /path/to/flowctl-py/main.py instrument app.py

# 6. Validate setup
python /path/to/flowctl-py/main.py validate

# 7. Run your application
python app.py
```

## What Gets Instrumented?

flowctl-py will instrument:
- ✅ Regular functions with body
- ✅ Async functions
- ✅ Class methods (including `__init__`)
- ✅ Module-level functions

flowctl-py will NOT instrument:
- ❌ Functions already having `@trace`
- ❌ Test functions (`test_*` or with test decorators)
- ❌ Special methods (`__str__`, `__repr__`, etc., except `__init__`)
- ❌ Empty functions or functions with only `pass`
- ❌ Functions with only docstrings

## Architecture

```
flowctl-py/
├── main.py          # CLI entry point with argparse
├── analyzer.py      # AST analysis using ast.NodeVisitor
├── instrumenter.py  # Code instrumentation using ast.NodeTransformer
└── README.md
```

### Analyzer

The analyzer uses `ast.NodeVisitor` to traverse the AST and collect statistics:

- Total files and functions
- Async vs sync functions
- Class methods vs module functions
- Already instrumented functions
- Lines of code

### Instrumenter

The instrumenter uses `ast.NodeTransformer` and `astor` to:

- Parse Python source files
- Add `@trace` decorators to eligible functions
- Generate modified source code
- Create backups (optional)
- Handle import statements

## Comparison with flowctl (Go) and flowctl-rs (Rust)

| Feature | flowctl (Go) | flowctl-rs (Rust) | flowctl-py (Python) |
|---------|-------------|-------------------|---------------------|
| Analyze | ✅ | ✅ | ✅ |
| Instrument | ✅ AST transform | ✅ Add attributes | ✅ Add decorators |
| Validate | ✅ | ✅ | ✅ |
| Language | Go | Rust | Python |
| AST Library | go/ast | syn | ast |
| Code Gen | go/ast | quote | astor |

## Development

```bash
# Test analyzer
python analyzer.py ../flowtrace_agent/tracer.py

# Test instrumenter
python instrumenter.py test_file.py

# Test CLI
python main.py analyze ../examples/
python main.py instrument test_file.py --dry-run
python main.py validate
```

## License

MIT License - See [LICENSE](../../../LICENSE)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../../../CONTRIBUTING.md)

---

**Made with 🐍 by the FlowTrace Team**
