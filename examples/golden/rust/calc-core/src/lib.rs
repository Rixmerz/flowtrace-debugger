//! Library half of the golden fixture: no FlowTrace imports, no attributes. The
//! trace is produced by building this under `flowtrace-rust`.

use std::fmt;

#[derive(Debug, PartialEq)]
pub enum CalcError {
    DivideByZero,
    Parse(String),
}

impl fmt::Display for CalcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CalcError::DivideByZero => write!(f, "division by zero"),
            CalcError::Parse(s) => write!(f, "not a number: {s}"),
        }
    }
}

impl std::error::Error for CalcError {}

#[derive(Debug)]
pub struct Operands {
    pub a: i32,
    pub b: i32,
}

pub struct Calculator {
    name: String,
    scratch: i32,
}

impl Calculator {
    pub fn new(name: &str) -> Self {
        Calculator { name: name.to_owned(), scratch: 0 }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn add(&self, a: i32, b: i32) -> i32 {
        self.validate(a);
        self.validate(b);
        a + b
    }

    // Private, and the one that panics.
    fn validate(&self, x: i32) {
        if x < 0 {
            panic!("negative operand: {x}");
        }
    }

    // `return` inside the body: the returned Err must still reach the trace.
    pub fn divide(&self, a: i32, b: i32) -> Result<i32, CalcError> {
        if b == 0 {
            return Err(CalcError::DivideByZero);
        }
        Ok(a / b)
    }

    // `?` is how most Rust errors leave a function.
    pub fn parse_divide(&self, a: &str, b: &str) -> Result<i32, CalcError> {
        let a = parse(a)?;
        let b = parse(b)?;
        self.divide(a, b)
    }

    pub fn sum(&self, ops: &Operands) -> i32 {
        ops.a + ops.b
    }

    // `password` is redacted by name, and never formatted.
    pub fn connect(&self, user: &str, password: &str) -> bool {
        !user.is_empty() && !password.is_empty()
    }

    // Generic: only the declared bounds are visible to the argument renderer.
    pub fn largest<T: PartialOrd + Copy + fmt::Debug>(&self, xs: &[T]) -> Option<T> {
        let mut it = xs.iter().copied();
        let first = it.next()?;
        Some(it.fold(first, |m, x| if x > m { x } else { m }))
    }

    // Returns a borrow of `self`: the closure form must keep compiling.
    pub fn scratch(&mut self) -> &mut i32 {
        &mut self.scratch
    }
}

fn parse(s: &str) -> Result<i32, CalcError> {
    s.parse::<i32>().map_err(|_| CalcError::Parse(s.to_owned()))
}
