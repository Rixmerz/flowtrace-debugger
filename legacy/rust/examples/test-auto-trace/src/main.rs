//! FlowTrace Rust Agent - Automatic #[trace] Instrumentation Test
//!
//! This example demonstrates the enhanced #[trace] macro with:
//! - Automatic argument capture
//! - Automatic return value capture
//! - Automatic Result<T, E> error handling
//! - Panic handling
//! - Both sync and async function support

use flowtrace_agent::{start_tracing, trace, Config};
use std::thread;
use std::time::Duration;

// ============================================================================
// Basic Functions (Automatic Args/Result Capture)
// ============================================================================

#[trace]
fn add(x: i32, y: i32) -> i32 {
    x + y
}

#[trace]
fn multiply(a: i32, b: i32) -> i32 {
    thread::sleep(Duration::from_millis(10));
    a * b
}

#[trace]
fn greet(name: &str, age: i32) -> String {
    format!("Hello, {}! You are {} years old.", name, age)
}

// ============================================================================
// Result<T, E> Functions (Automatic Error Capture)
// ============================================================================

#[trace]
fn divide(x: i32, y: i32) -> Result<i32, String> {
    if y == 0 {
        return Err("Division by zero".to_string());
    }
    Ok(x / y)
}

#[trace]
fn validate_age(age: i32) -> Result<(), String> {
    if age < 0 {
        return Err(format!("Invalid age: {}", age));
    }
    if age > 150 {
        return Err(format!("Age too high: {}", age));
    }
    Ok(())
}

#[trace]
fn parse_number(s: &str) -> Result<i32, String> {
    s.parse::<i32>()
        .map_err(|e| format!("Parse error: {}", e))
}

// ============================================================================
// Void Functions
// ============================================================================

#[trace]
fn log_message(msg: &str) {
    println!("[LOG] {}", msg);
}

#[trace]
fn sleep_ms(millis: u64) {
    thread::sleep(Duration::from_millis(millis));
}

// ============================================================================
// Complex Types
// ============================================================================

#[derive(Debug)]
struct User {
    id: i32,
    name: String,
    email: String,
}

#[trace]
fn create_user(id: i32, name: String, email: String) -> Result<User, String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if !email.contains('@') {
        return Err(format!("Invalid email: {}", email));
    }

    Ok(User { id, name, email })
}

#[trace]
fn get_user_info(user: &User) -> String {
    format!("User #{}: {} ({})", user.id, user.name, user.email)
}

// ============================================================================
// Private Functions (lowercase - equivalent to other languages' private)
// ============================================================================

#[trace]
fn internal_calculation(x: i32, y: i32) -> i32 {
    let intermediate = x * 2;
    let result = intermediate + y;
    result
}

#[trace]
fn secret_operation(value: i32) -> Result<i32, String> {
    if value < 0 {
        return Err("Negative values not allowed".to_string());
    }
    Ok(value * 3)
}

// ============================================================================
// Async Functions (if tokio available)
// ============================================================================

#[trace]
async fn async_fetch(id: i32) -> Result<String, String> {
    tokio::time::sleep(Duration::from_millis(50)).await;
    if id < 0 {
        return Err("Invalid ID".to_string());
    }
    Ok(format!("Data for ID: {}", id))
}

#[trace]
async fn async_process(data: String) -> String {
    tokio::time::sleep(Duration::from_millis(30)).await;
    format!("Processed: {}", data)
}

// ============================================================================
// Test Scenarios
// ============================================================================

fn run_basic_tests() {
    println!("\n========================================");
    println!("SCENARIO 1: Basic Functions");
    println!("========================================\n");

    let result = add(5, 3);
    println!("✅ add(5, 3) = {}", result);

    let result = multiply(4, 7);
    println!("✅ multiply(4, 7) = {}", result);

    let result = greet("Alice", 30);
    println!("✅ greet result: {}", result);
}

fn run_result_tests() {
    println!("\n========================================");
    println!("SCENARIO 2: Result<T, E> Functions");
    println!("========================================\n");

    // Success case
    match divide(10, 2) {
        Ok(result) => println!("✅ divide(10, 2) = {}", result),
        Err(e) => println!("❌ Error: {}", e),
    }

    // Error case
    match divide(10, 0) {
        Ok(result) => println!("✅ divide(10, 0) = {}", result),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    // Validation success
    match validate_age(25) {
        Ok(_) => println!("✅ validate_age(25) passed"),
        Err(e) => println!("❌ Error: {}", e),
    }

    // Validation errors
    match validate_age(-5) {
        Ok(_) => println!("✅ Age valid"),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    match validate_age(200) {
        Ok(_) => println!("✅ Age valid"),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    // Parse success
    match parse_number("42") {
        Ok(n) => println!("✅ parse_number(\"42\") = {}", n),
        Err(e) => println!("❌ Error: {}", e),
    }

    // Parse error
    match parse_number("abc") {
        Ok(n) => println!("✅ Parsed: {}", n),
        Err(e) => println!("❌ Expected error: {}", e),
    }
}

fn run_void_tests() {
    println!("\n========================================");
    println!("SCENARIO 3: Void Functions");
    println!("========================================\n");

    log_message("This is a test message");
    println!("✅ log_message called");

    sleep_ms(50);
    println!("✅ sleep_ms(50) completed");
}

fn run_complex_tests() {
    println!("\n========================================");
    println!("SCENARIO 4: Complex Types");
    println!("========================================\n");

    // Success case
    match create_user(1, "Bob".to_string(), "bob@example.com".to_string()) {
        Ok(user) => {
            println!("✅ User created: {:?}", user);
            let info = get_user_info(&user);
            println!("✅ User info: {}", info);
        }
        Err(e) => println!("❌ Error: {}", e),
    }

    // Error cases
    match create_user(2, "".to_string(), "test@example.com".to_string()) {
        Ok(_) => println!("✅ User created"),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    match create_user(3, "Charlie".to_string(), "invalid-email".to_string()) {
        Ok(_) => println!("✅ User created"),
        Err(e) => println!("❌ Expected error: {}", e),
    }
}

fn run_private_tests() {
    println!("\n========================================");
    println!("SCENARIO 5: Private Functions");
    println!("========================================\n");

    let result = internal_calculation(5, 10);
    println!("✅ internal_calculation(5, 10) = {}", result);

    match secret_operation(7) {
        Ok(result) => println!("✅ secret_operation(7) = {}", result),
        Err(e) => println!("❌ Error: {}", e),
    }

    match secret_operation(-3) {
        Ok(_) => println!("✅ Operation succeeded"),
        Err(e) => println!("❌ Expected error: {}", e),
    }
}

#[tokio::main]
async fn main() {
    println!("\n============================================================");
    println!("FlowTrace Rust Agent - Automatic #[trace] Test");
    println!("============================================================");

    // Configure FlowTrace
    let config = Config {
        log_file: "flowtrace-auto-trace.jsonl".to_string(),
        ..Default::default()
    };

    start_tracing(config).expect("Failed to start tracing");

    println!("\n📊 FlowTrace Configuration:");
    println!("  - Log file: flowtrace-auto-trace.jsonl");
    println!("  - Automatic arg capture: ✅ ENABLED");
    println!("  - Automatic result capture: ✅ ENABLED");
    println!("  - Automatic error capture: ✅ ENABLED");
    println!("\n✅ FlowTrace agent started");

    // Run test scenarios
    run_basic_tests();
    run_result_tests();
    run_void_tests();
    run_complex_tests();
    run_private_tests();

    // Async tests
    println!("\n========================================");
    println!("SCENARIO 6: Async Functions");
    println!("========================================\n");

    match async_fetch(42).await {
        Ok(data) => {
            println!("✅ async_fetch(42) = {}", data);
            let processed = async_process(data).await;
            println!("✅ async_process result: {}", processed);
        }
        Err(e) => println!("❌ Error: {}", e),
    }

    match async_fetch(-1).await {
        Ok(_) => println!("✅ Fetched"),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    println!("\n============================================================");
    println!("Test Execution Complete");
    println!("============================================================");
    println!("\n📄 Trace logs written to: flowtrace-auto-trace.jsonl");
    println!("\n💡 Analyze logs:");
    println!("  cat flowtrace-auto-trace.jsonl | jq .");
    println!("  cat flowtrace-auto-trace.jsonl | jq -r '.method' | sort | uniq");
    println!("  cat flowtrace-auto-trace.jsonl | jq 'select(.args != null) | .args'");
    println!("  cat flowtrace-auto-trace.jsonl | jq 'select(.result != null) | .result'");
    println!("  cat flowtrace-auto-trace.jsonl | jq 'select(.exception != null) | .exception'");
}
