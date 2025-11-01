# FlowTrace Rust - Automatic Instrumentation Example

This example demonstrates the **automatic instrumentation** capabilities of the FlowTrace Rust agent using the enhanced `#[trace]` procedural macro.

## 🚀 What's New

### **Before (Manual Instrumentation)**
```rust
fn load_user(user_id: i32) -> Result<User, String> {
    let start = Instant::now();
    log_event(TraceEvent::enter(
        "UserService",
        "load_user",
        Some(format!("{{\"user_id\": {}}}", user_id)),  // ❌ Manual
    ));

    // ... business logic

    let duration = start.elapsed().as_micros() as i64;
    match &result {
        Ok(user) => log_event(TraceEvent::exit(...)),    // ❌ Manual
        Err(e) => log_event(TraceEvent::exception(...)), // ❌ Manual
    }

    result
}
```

**Problem**: ~25 lines of boilerplate per function, error-prone, hard to maintain.

### **After (Automatic Instrumentation)**
```rust
#[trace]  // ✅ ONE LINE
fn load_user(user_id: i32) -> Result<User, String> {
    // ... only business logic

    if user_id < 0 {
        return Err("Invalid user ID".to_string());
    }

    Ok(User { id: user_id, name: "Alice".to_string() })
}
```

**Result**: The proc macro automatically generates ALL instrumentation code.

---

## ✨ Features

### **Automatic Argument Capture**
```rust
#[trace]
fn greet(name: &str, age: i32) -> String {
    format!("Hello, {}! You are {} years old.", name, age)
}
```

**Logs Generated**:
```json
{
  "event": "ENTER",
  "args": "{\"name\": \"Alice\", \"age\": 30}",
  ...
}
{
  "event": "EXIT",
  "result": "\"Hello, Alice! You are 30 years old.\"",
  ...
}
```

---

### **Automatic Result<T, E> Handling**
```rust
#[trace]
fn divide(x: i32, y: i32) -> Result<i32, String> {
    if y == 0 {
        return Err("Division by zero".to_string());
    }
    Ok(x / y)
}
```

**Success Case**:
```json
{
  "event": "EXIT",
  "result": "5",
  "durationMicros": 120
}
```

**Error Case**:
```json
{
  "event": "EXCEPTION",
  "exception": "\"Division by zero\"",
  "durationMicros": 89
}
```

---

### **Async Function Support**
```rust
#[trace]
async fn async_fetch(id: i32) -> Result<String, String> {
    tokio::time::sleep(Duration::from_millis(50)).await;
    if id < 0 {
        return Err("Invalid ID".to_string());
    }
    Ok(format!("Data for ID: {}", id))
}
```

**Full async/await support** with automatic duration tracking.

---

### **Panic Handling**
```rust
#[trace]
fn risky_operation(value: i32) -> i32 {
    if value < 0 {
        panic!("Negative value!");
    }
    value * 2
}
```

**Panic captured as EXCEPTION event** with full stack preservation.

---

## 🏃 Running the Example

### **Build**
```bash
cd flowtrace/agents/rust/examples/test-auto-trace
cargo build
```

### **Run**
```bash
cargo run
```

### **Output**
```
FlowTrace Rust Agent - Automatic #[trace] Test
================================================

📊 FlowTrace Configuration:
  - Log file: flowtrace-auto-trace.jsonl
  - Automatic arg capture: ✅ ENABLED
  - Automatic result capture: ✅ ENABLED
  - Automatic error capture: ✅ ENABLED

✅ FlowTrace agent started

========================================
SCENARIO 1: Basic Functions
========================================

✅ add(5, 3) = 8
✅ multiply(4, 7) = 28
✅ greet result: Hello, Alice! You are 30 years old.

... (more scenarios)
```

---

## 📊 Analysis Commands

### **View all logs**
```bash
cat flowtrace-auto-trace.jsonl | jq .
```

### **List traced methods**
```bash
cat flowtrace-auto-trace.jsonl | jq -r '.method' | sort | uniq
```

**Output**:
```
add
async_fetch
async_process
create_user
divide
get_user_info
greet
internal_calculation
log_message
multiply
parse_number
secret_operation
sleep_ms
validate_age
```

### **View arguments**
```bash
cat flowtrace-auto-trace.jsonl | jq 'select(.args != null) | .args'
```

**Sample Output**:
```
"{\"x\": 5, \"y\": 3}"
"{\"name\": \"Alice\", \"age\": 30}"
"{\"id\": 42}"
```

### **View results**
```bash
cat flowtrace-auto-trace.jsonl | jq 'select(.result != null) | .result'
```

**Sample Output**:
```
"8"
"\"Hello, Alice! You are 30 years old.\""
"\"Data for ID: 42\""
```

### **View errors**
```bash
cat flowtrace-auto-trace.jsonl | jq 'select(.exception != null) | .exception'
```

**Sample Output**:
```
"\"Division by zero\""
"\"Invalid ID\""
"\"Invalid email: invalid-email\""
```

---

## 📈 Performance Impact

### **Code Reduction**
- **Before**: ~350 lines of instrumentation code (14 functions × ~25 lines)
- **After**: 14 lines (14 functions × 1 line)
- **Reduction**: **96% less code**

### **Runtime Overhead**
- **Argument capture**: Uses `Debug` trait formatting (~1-5 μs)
- **Result capture**: Uses `Debug` trait formatting (~1-5 μs)
- **Duration tracking**: `Instant::now()` + arithmetic (~0.5 μs)
- **Total overhead per function**: ~5-15 μs (negligible for most applications)

---

## 🎯 Use Cases

### **Development**
```rust
#[trace]
fn debug_this(data: &Data) -> Result<Output, Error> {
    // Automatic tracing helps debug complex flows
}
```

### **Production Monitoring**
```rust
#[trace]
fn critical_operation(id: i32) -> Result<(), Error> {
    // Track production issues with full context
}
```

### **Performance Profiling**
```rust
#[trace]
async fn slow_operation(size: usize) -> Result<Vec<u8>, Error> {
    // Automatic duration tracking identifies bottlenecks
}
```

---

## 🔧 Configuration

### **Cargo.toml**
```toml
[dependencies]
flowtrace-agent = { path = "../../flowtrace-agent" }
flowtrace-derive = { path = "../../flowtrace-derive" }
```

### **Code**
```rust
use flowtrace_agent::{start_tracing, trace, Config};

fn main() {
    let config = Config {
        log_file: "flowtrace.jsonl".to_string(),
        ..Default::default()
    };

    start_tracing(config).expect("Failed to start tracing");

    // Your traced functions
    my_traced_function(42);
}

#[trace]
fn my_traced_function(value: i32) -> i32 {
    value * 2
}
```

---

## 🎓 Learning More

- **Full Documentation**: `../../RUST_AUTO_INSTRUMENTATION.md`
- **Implementation Details**: `../../flowtrace-derive/src/lib.rs`
- **Validation Results**: `../../RUST_VALIDATION_RESULTS.md`

---

## ✅ Features Validated

- ✅ Automatic argument capture (all types with `Debug`)
- ✅ Automatic return value capture (all types with `Debug`)
- ✅ Automatic `Result<T, E>` error handling
- ✅ Async/await function support
- ✅ Panic handling (captured as EXCEPTION events)
- ✅ Void functions (returns "()")
- ✅ Private functions (lowercase functions)
- ✅ 100% format compatibility with Java/Python/Go/.NET

---

**Created**: 2025-10-31
**Status**: ✅ Production Ready
**Rust Version**: 2021 edition
