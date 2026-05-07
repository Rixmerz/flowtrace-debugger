use flowtrace_agent::{TraceEvent, start_tracing, log_event, Config};
use std::thread;
use std::time::{Duration, Instant};

// ============================================================================
// User Service
// ============================================================================

#[derive(Debug, Clone)]
struct User {
    id: i32,
    name: String,
    email: String,
}

struct UserService {
    users: std::collections::HashMap<i32, User>,
}

impl UserService {
    // Constructor (always private in Rust structs)
    fn new() -> Self {
        let mut users = std::collections::HashMap::new();
        users.insert(42, User {
            id: 42,
            name: "User42".to_string(),
            email: "user42@example.com".to_string(),
        });
        users.insert(999, User {
            id: 999,
            name: "Invalid".to_string(),
            email: "not-an-email".to_string(),
        });

        UserService { users }
    }

    // PUBLIC method (pub fn)
    pub fn load_user(&self, user_id: i32) -> Result<User, String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::UserService",
            "load_user",
            Some(format!("{{\"user_id\": {}}}", user_id)),
        ));

        println!("\n[PUBLIC] load_user({})", user_id);

        sleep(50);
        self.validate_user_id(user_id)?;
        let result = self.internal_load(user_id);

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::UserService",
            "load_user",
            Some(format!("{:?}", result)),
            Some(duration_micros),
        ));

        result
    }

    // PUBLIC method (pub fn)
    pub fn save_user(&self, user: &User) -> Result<(), String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::UserService",
            "save_user",
            Some(format!("{{\"user\": \"{}\"}}", user.name)),
        ));

        println!("\n[PUBLIC] save_user({})", user.name);

        sleep(30);

        if !self.is_valid_email(&user.email) {
            let duration_micros = start.elapsed().as_micros() as i64;
            log_event(TraceEvent::exception(
                "test_private::UserService",
                "save_user",
                &format!("Invalid email: {}", user.email),
                Some(duration_micros),
            ));
            return Err(format!("Invalid email: {}", user.email));
        }

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::UserService",
            "save_user",
            Some("()".to_string()),
            Some(duration_micros),
        ));

        Ok(())
    }

    // PRIVATE method (fn without pub)
    fn validate_user_id(&self, user_id: i32) -> Result<(), String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::UserService",
            "validate_user_id",
            Some(format!("{{\"user_id\": {}}}", user_id)),
        ));

        println!("  [PRIVATE] validate_user_id({})", user_id);

        if user_id <= 0 {
            let duration_micros = start.elapsed().as_micros() as i64;
            log_event(TraceEvent::exception(
                "test_private::UserService",
                "validate_user_id",
                &format!("Invalid user ID: {}", user_id),
                Some(duration_micros),
            ));
            return Err(format!("Invalid user ID: {}", user_id));
        }

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::UserService",
            "validate_user_id",
            Some("()".to_string()),
            Some(duration_micros),
        ));

        Ok(())
    }

    // PRIVATE method (fn without pub)
    fn is_valid_email(&self, email: &str) -> bool {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::UserService",
            "is_valid_email",
            Some(format!("{{\"email\": \"{}\"}}", email)),
        ));

        println!("  [PRIVATE] is_valid_email({})", email);

        let result = email.contains('@') && email.len() > 3;

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::UserService",
            "is_valid_email",
            Some(format!("{}", result)),
            Some(duration_micros),
        ));

        result
    }

    // PRIVATE method (fn without pub)
    fn internal_load(&self, user_id: i32) -> Result<User, String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::UserService",
            "internal_load",
            Some(format!("{{\"user_id\": {}}}", user_id)),
        ));

        println!("  [PRIVATE] internal_load({})", user_id);

        let result = self.users.get(&user_id).cloned()
            .ok_or_else(|| format!("User not found: {}", user_id));

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::UserService",
            "internal_load",
            Some(format!("{:?}", result)),
            Some(duration_micros),
        ));

        result
    }
}

// ============================================================================
// Order Service
// ============================================================================

#[derive(Debug)]
struct Order {
    id: i32,
    amount: f64,
    status: String,
}

struct OrderService;

impl OrderService {
    // PUBLIC method (pub fn)
    pub fn process_order(&self, order_id: i32, amount: f64) -> Result<Order, String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::OrderService",
            "process_order",
            Some(format!("{{\"order_id\": {}, \"amount\": {}}}", order_id, amount)),
        ));

        println!("\n[PUBLIC] process_order({}, {:.2})", order_id, amount);

        self.validate_amount(amount)?;
        sleep(100);

        let order = Order {
            id: order_id,
            amount,
            status: "COMPLETED".to_string(),
        };

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::OrderService",
            "process_order",
            Some(format!("{:?}", order)),
            Some(duration_micros),
        ));

        Ok(order)
    }

    // PUBLIC method (pub fn)
    pub fn cancel_order(&self, order_id: i32) {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::OrderService",
            "cancel_order",
            Some(format!("{{\"order_id\": {}}}", order_id)),
        ));

        println!("\n[PUBLIC] cancel_order({})", order_id);

        sleep(30);
        self.internal_audit(order_id);

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::OrderService",
            "cancel_order",
            Some("()".to_string()),
            Some(duration_micros),
        ));
    }

    // PRIVATE method (fn without pub)
    fn validate_amount(&self, amount: f64) -> Result<(), String> {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::OrderService",
            "validate_amount",
            Some(format!("{{\"amount\": {}}}", amount)),
        ));

        println!("  [PRIVATE] validate_amount({:.2})", amount);

        if amount <= 0.0 {
            let duration_micros = start.elapsed().as_micros() as i64;
            log_event(TraceEvent::exception(
                "test_private::OrderService",
                "validate_amount",
                &format!("Amount must be positive: {}", amount),
                Some(duration_micros),
            ));
            return Err(format!("Amount must be positive: {}", amount));
        }

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::OrderService",
            "validate_amount",
            Some("()".to_string()),
            Some(duration_micros),
        ));

        Ok(())
    }

    // PRIVATE method (fn without pub)
    fn internal_audit(&self, order_id: i32) {
        let start = Instant::now();
        log_event(TraceEvent::enter(
            "test_private::OrderService",
            "internal_audit",
            Some(format!("{{\"order_id\": {}}}", order_id)),
        ));

        println!("  [PRIVATE] internal_audit({})", order_id);
        println!("    Auditing order {}", order_id);

        let duration_micros = start.elapsed().as_micros() as i64;
        log_event(TraceEvent::exit(
            "test_private::OrderService",
            "internal_audit",
            Some("()".to_string()),
            Some(duration_micros),
        ));
    }
}

// ============================================================================
// Helper Functions (private at module level)
// ============================================================================

// PRIVATE function (fn without pub)
fn sleep(millis: u64) {
    let start = Instant::now();
    log_event(TraceEvent::enter(
        "test_private",
        "sleep",
        Some(format!("{{\"millis\": {}}}", millis)),
    ));

    println!("  [PRIVATE] sleep({}ms)", millis);
    thread::sleep(Duration::from_millis(millis));

    let duration_micros = start.elapsed().as_micros() as i64;
    log_event(TraceEvent::exit(
        "test_private",
        "sleep",
        Some("()".to_string()),
        Some(duration_micros),
    ));
}

// ============================================================================
// Test Scenarios
// ============================================================================

fn run_user_scenario() {
    let start = Instant::now();
    log_event(TraceEvent::enter(
        "test_private",
        "run_user_scenario",
        None,
    ));

    println!("\n============================================================");
    println!("SCENARIO 1: User Service - Success Case");
    println!("============================================================");

    let service = UserService::new();

    // Test 1: Load user (should call private methods)
    match service.load_user(42) {
        Ok(user) => println!("✅ Loaded user: {:?}", user),
        Err(e) => println!("❌ Error: {}", e),
    }

    // Test 2: Save user (should call private methods)
    let user = User {
        id: 42,
        name: "User42".to_string(),
        email: "user42@example.com".to_string(),
    };
    match service.save_user(&user) {
        Ok(_) => println!("✅ Saved user: {}", user.name),
        Err(e) => println!("❌ Error: {}", e),
    }

    let duration_micros = start.elapsed().as_micros() as i64;
    log_event(TraceEvent::exit(
        "test_private",
        "run_user_scenario",
        Some("()".to_string()),
        Some(duration_micros),
    ));
}

fn run_order_scenario() {
    let start = Instant::now();
    log_event(TraceEvent::enter(
        "test_private",
        "run_order_scenario",
        None,
    ));

    println!("\n============================================================");
    println!("SCENARIO 2: Order Service");
    println!("============================================================");

    let service = OrderService;

    // Test 3: Process order (should call validate_amount)
    match service.process_order(101, 99.99) {
        Ok(order) => println!("✅ Processed order: {:?}", order),
        Err(e) => println!("❌ Error: {}", e),
    }

    // Test 4: Cancel order (should call internal_audit)
    service.cancel_order(101);
    println!("✅ Cancelled order 101");

    let duration_micros = start.elapsed().as_micros() as i64;
    log_event(TraceEvent::exit(
        "test_private",
        "run_order_scenario",
        Some("()".to_string()),
        Some(duration_micros),
    ));
}

fn run_error_scenario() {
    let start = Instant::now();
    log_event(TraceEvent::enter(
        "test_private",
        "run_error_scenario",
        None,
    ));

    println!("\n============================================================");
    println!("SCENARIO 3: Error Handling");
    println!("============================================================");

    let service = UserService::new();

    // Test 5: Invalid email (should call is_valid_email and return error)
    let invalid_user = User {
        id: 999,
        name: "Invalid".to_string(),
        email: "not-an-email".to_string(),
    };
    match service.save_user(&invalid_user) {
        Ok(_) => println!("✅ Saved user"),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    // Test 6: Invalid user ID (should call validate_user_id and return error)
    match service.load_user(-1) {
        Ok(user) => println!("✅ Loaded user: {:?}", user),
        Err(e) => println!("❌ Expected error: {}", e),
    }

    let duration_micros = start.elapsed().as_micros() as i64;
    log_event(TraceEvent::exit(
        "test_private",
        "run_error_scenario",
        Some("()".to_string()),
        Some(duration_micros),
    ));
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    println!("\n============================================================");
    println!("FlowTrace Rust Agent - Private Functions Test");
    println!("============================================================");

    // Configure FlowTrace
    let config = Config {
        log_file: "flowtrace-rust-private.jsonl".to_string(),
        ..Default::default()
    };

    start_tracing(config).expect("Failed to initialize tracer");

    println!("\n📊 FlowTrace Configuration:");
    println!("  - Log file: flowtrace-rust-private.jsonl");
    println!("\n✅ FlowTrace agent started");

    // Run test scenarios
    run_user_scenario();
    run_order_scenario();
    run_error_scenario();

    println!("\n============================================================");
    println!("Test Execution Complete");
    println!("============================================================");
    println!("\n📄 Trace logs written to: flowtrace-rust-private.jsonl");
    println!("\n💡 Analyze logs:");
    println!("  cat flowtrace-rust-private.jsonl | jq .");
    println!("  cat flowtrace-rust-private.jsonl | jq -r '.method' | sort | uniq");
}
