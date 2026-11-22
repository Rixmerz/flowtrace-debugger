use calc_core::{Calculator, Operands};

fn main() {
    let mut calc = Calculator::new("demo");
    run(&mut calc);
    spawn_worker();
}

fn run(calc: &mut Calculator) -> i32 {
    let total = calc.add(2, 3);
    let _ = calc.divide(1, 0);
    let _ = calc.parse_divide("8", "x");
    safe_add(calc, 10, -1);
    let _ = calc.sum(&Operands { a: 1, b: 2 });
    let _ = calc.connect("bob", "hunter2");
    let _ = calc.largest(&[1, 5, 3]);
    *calc.scratch() += 1;
    let _ = calc.name();
    total
}

// A panic recovered upstream: the unwound spans still close, with the panic as their error.
fn safe_add(calc: &Calculator, a: i32, b: i32) -> Option<i32> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| calc.add(a, b))).ok()
}

// Rust has no ambient context across threads: a span started on a new thread is a root.
fn spawn_worker() {
    std::thread::scope(|s| {
        std::thread::Builder::new()
            .name("worker".into())
            .spawn_scoped(s, || helper(7))
            .expect("spawn")
            .join()
            .expect("join");
    });
}

fn helper(n: i32) -> i32 {
    n * 2
}
