# flowctl-rs

**CLI tool for FlowTrace Rust agent** - Analyze and instrument Rust code for automatic tracing.

## Features

- 🔍 **Analyze** Rust projects to find instrumentable functions
- 🔧 **Instrument** code automatically with `#[trace]` attributes
- ✅ **Validate** FlowTrace setup in your project
- 📊 **Statistics** on functions, LOC, and instrumentation coverage

## Installation

### From source:

```bash
cd flowctl-rs
cargo install --path .
```

### Verify installation:

```bash
flowctl-rs --version
```

## Usage

### Analyze Project

Analyze a Rust file or directory to find instrumentable functions:

```bash
# Analyze single file
flowctl-rs analyze src/main.rs

# Analyze entire project
flowctl-rs analyze src/

# Show detailed statistics
flowctl-rs analyze src/ --verbose
```

**Output:**
```
🔍 Analyzing Rust project...

📊 Analysis Results:

  5 files analyzed
  42 total functions found
  35 instrumentable functions
  7 already instrumented
  1250 lines of code

💡 Tip: Run 'flowctl-rs instrument <file>' to add tracing
```

### Instrument Code

Add `#[trace]` attributes to instrumentable functions:

```bash
# Dry run - see what would be instrumented
flowctl-rs instrument src/main.rs --dry-run

# Instrument file (creates backup by default)
flowctl-rs instrument src/main.rs

# Instrument without backup
flowctl-rs instrument src/main.rs --no-backup
```

**Output:**
```
🔧 Instrumenting Rust code...

✅ Instrumentation complete!

  8 functions instrumented
  Backup created: src/main.rs.bak

💡 Next steps:
  1. Add flowtrace-agent and flowtrace-derive to Cargo.toml
  2. Run your application
  3. Check flowtrace.jsonl for traces
```

### Validate Setup

Check if FlowTrace is properly configured in your project:

```bash
flowctl-rs validate
```

**Output:**
```
🔍 Validating FlowTrace setup...

✅ Cargo.toml found
✅ flowtrace-agent dependency found
✅ flowtrace-derive dependency found
✅ src/ directory found

✅ FlowTrace setup looks good!
```

## Commands

### `analyze <path>`

Analyze Rust code for instrumentable functions.

**Options:**
- `-v, --verbose`: Show detailed statistics

### `instrument <path>`

Add `#[trace]` attributes to functions.

**Options:**
- `-n, --dry-run`: Preview changes without modifying files
- `-b, --backup`: Create backup before modifying (default: true)

### `validate`

Validate FlowTrace setup in current project.

### `version`

Show version information.

## Example Workflow

```bash
# 1. Initialize new Rust project
cargo new my-app
cd my-app

# 2. Add FlowTrace dependencies
cat >> Cargo.toml <<EOF
flowtrace-agent = "1.0"
flowtrace-derive = "1.0"
EOF

# 3. Analyze your code
flowctl-rs analyze src/

# 4. Preview instrumentation
flowctl-rs instrument src/main.rs --dry-run

# 5. Instrument your code
flowctl-rs instrument src/main.rs

# 6. Validate setup
flowctl-rs validate

# 7. Run your application
cargo run
```

## Configuration

flowctl-rs uses `syn` for parsing and `quote` for code generation, ensuring:

- ✅ Accurate Rust syntax parsing
- ✅ Preserves formatting where possible
- ✅ Handles async/await correctly
- ✅ Skips test functions automatically
- ✅ Creates backups by default

## What Gets Instrumented?

flowctl-rs will instrument:
- ✅ Regular functions with body
- ✅ Async functions
- ✅ Public and private functions
- ✅ Methods in impl blocks

flowctl-rs will NOT instrument:
- ❌ Functions already having `#[trace]`
- ❌ Test functions (`#[test]`)
- ❌ `main()` function
- ❌ Functions without body
- ❌ Functions in test modules

## Architecture

```
flowctl-rs/
├── src/
│   ├── main.rs          # CLI entry point with clap
│   ├── analyzer.rs      # Code analysis logic
│   └── instrumenter.rs  # Code instrumentation logic
├── Cargo.toml
└── README.md
```

### Analyzer

The analyzer uses `syn::visit::Visit` to traverse the AST and collect statistics:

- Total files and functions
- Async vs sync functions
- Public vs private functions
- Already instrumented functions
- Lines of code

### Instrumenter

The instrumenter uses `syn` and `quote` to:

- Parse Rust source files
- Add `#[trace]` attributes to eligible functions
- Generate modified source code
- Create backups (optional)
- Handle errors gracefully

## Comparison with Go flowctl

| Feature | flowctl (Go) | flowctl-rs (Rust) |
|---------|-------------|-------------------|
| Analyze | ✅ | ✅ |
| Instrument | ✅ AST transform | ✅ Add attributes |
| Clean | ✅ | 🔄 (Backup restore) |
| Validate | ✅ | ✅ |
| Performance | Fast | Very Fast |
| Safety | Go safety | Rust safety |

## Development

```bash
# Build
cargo build

# Run tests
cargo test

# Run with sample file
cargo run -- analyze ../flowtrace-agent/src/lib.rs --verbose

# Install locally
cargo install --path .
```

## License

MIT License - See [LICENSE](../../../LICENSE)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../../../CONTRIBUTING.md)

---

**Made with 🦀 by the FlowTrace Team**
