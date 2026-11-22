//! Every function shape the rewriter has to leave compiling. Nothing here asserts
//! behaviour: the test builds this under the driver and fails if rustc rejects
//! the instrumented source (the driver would then silently build it uninstrumented,
//! which is exactly the regression to catch).
#![allow(dead_code, clippy::all)]

use std::collections::HashMap;
use std::error::Error;
use std::fmt::{self, Debug, Display};

type Res<T> = std::result::Result<T, MyErr>;

#[derive(Debug)]
struct MyErr(String);
impl Display for MyErr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl Error for MyErr {}

#[derive(Debug, Clone, Default)]
pub struct Holder<T> {
    items: Vec<T>,
    label: String,
}

pub trait Shape {
    fn area(&self) -> f64;
    fn describe(&self) -> String {
        format!("area {}", self.area())
    }
}

struct Sq(f64);
impl Shape for Sq {
    fn area(&self) -> f64 {
        self.0 * self.0
    }
}

impl<T: Clone + Debug> Holder<T> {
    pub fn new(label: &str) -> Self {
        Holder { items: Vec::new(), label: label.to_owned() }
    }
    pub fn push(&mut self, t: T) -> &mut Self {
        self.items.push(t);
        self
    }
    pub fn first_mut(&mut self) -> Option<&mut T> {
        self.items.first_mut()
    }
    pub fn iter_mut(&mut self) -> std::slice::IterMut<'_, T> {
        self.items.iter_mut()
    }
    pub fn iter(&self) -> impl Iterator<Item = &T> + '_ {
        self.items.iter()
    }
    pub fn label(&self) -> &str {
        &self.label
    }
    pub fn into_items(self) -> Vec<T> {
        self.items
    }
    pub fn map_all<U, F>(&self, f: F) -> Vec<U>
    where
        F: Fn(&T) -> U,
    {
        self.items.iter().map(f).collect()
    }
}

impl<T> Holder<T> {
    pub(crate) fn len(&self) -> usize {
        self.items.len()
    }
    pub(in crate) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

pub mod nested {
    pub mod deeper {
        pub fn twice(x: u32) -> u32 {
            x * 2
        }
        pub(crate) fn pair((a, b): (u32, u32), _unused: u8) -> u32 {
            a + b
        }
    }
    pub fn ret_box(n: i32) -> Box<dyn Fn(i32) -> i32> {
        Box::new(move |x| x + n)
    }
}

fn parse_all(xs: &[&str]) -> Res<Vec<i32>> {
    let mut out = Vec::new();
    for x in xs {
        out.push(x.parse::<i32>().map_err(|e| MyErr(e.to_string()))?);
    }
    Ok(out)
}

fn boxed_err(s: &str) -> Result<i32, Box<dyn Error>> {
    let n: i32 = s.parse()?;
    if n < 0 {
        return Err(Box::new(MyErr("negative".into())));
    }
    Ok(n)
}

fn early(n: i32) -> Option<i32> {
    let Some(x) = (n > 0).then_some(n) else { return None };
    for i in 0..10 {
        if i == x {
            return Some(i);
        }
    }
    'outer: loop {
        break 'outer;
    }
    None
}

fn dyn_arg(s: &dyn Shape, f: fn(i32) -> i32, g: &dyn Fn(u8) -> u8, h: impl Fn() -> u8) -> f64 {
    let _ = (f(1), g(1), h());
    s.area()
}

fn generic_dbg<T: Debug>(t: T) -> String {
    format!("{t:?}")
}

fn generic_opaque<T>(_t: T, _u: &T) {}

fn lifetimes<'a, 'b: 'a>(a: &'a str, _b: &'b str) -> &'a str {
    a
}

fn pick<'a>(a: &'a mut Vec<u8>, _b: &mut Vec<u8>) -> &'a mut u8 {
    &mut a[0]
}

fn hashed(m: &HashMap<String, u32>) -> Vec<(&String, &u32)> {
    m.iter().collect()
}

fn r#match(r#type: u8) -> u8 {
    r#type
}

fn fib(n: u32) -> u32 {
    if n < 2 {
        n
    } else {
        fib(n - 1) + fib(n - 2)
    }
}

unsafe fn raw(p: *const u8) -> u8 {
    *p
}

#[no_mangle]
pub extern "C" fn exported(x: i32) -> i32 {
    x + 1
}

const fn constant() -> u8 {
    3
}

async fn asynchronous() -> u8 {
    1
}

#[inline(always)]
fn forced() -> u8 {
    2
}

#[track_caller]
fn located() -> &'static str {
    std::panic::Location::caller().file()
}

fn never_returns() -> ! {
    std::process::exit(0)
}

fn diverges_with_panic(flag: bool) -> u8 {
    if flag {
        panic!("never taken")
    }
    1
}

macro_rules! make_fn {
    ($name:ident) => {
        fn $name() -> u8 {
            9
        }
    };
}
make_fn!(from_macro);

#[cfg(not(test))]
fn only_prod() -> u8 {
    4
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn t() {
        assert_eq!(fib(3), 2);
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut h = Holder::<i32>::new("h");
    h.push(1).push(2);
    *h.first_mut().unwrap() += 1;
    for x in h.iter_mut() {
        *x += 1;
    }
    assert_eq!(h.iter().count(), 2);
    assert_eq!(h.label(), "h");
    assert_eq!(h.map_all(|x| x * 2).len(), 2);
    assert!(!h.is_empty() && h.len() == 2);
    assert_eq!(h.clone().into_items().len(), 2);
    assert_eq!(nested::deeper::twice(2), 4);
    assert_eq!(nested::deeper::pair((1, 2), 0), 3);
    assert_eq!(nested::ret_box(1)(1), 2);
    assert!(parse_all(&["1", "x"]).is_err());
    assert!(boxed_err("-1").is_err());
    assert_eq!(boxed_err("5")?, 5);
    assert_eq!(early(3), Some(3));
    assert_eq!(dyn_arg(&Sq(2.0), |x| x, &|x| x, || 1), 4.0);
    assert_eq!(Sq(1.0).describe(), "area 1");
    assert_eq!(generic_dbg((1, "a")), "(1, \"a\")");
    generic_opaque(1u8, &2u8);
    assert_eq!(lifetimes("a", "b"), "a");
    let (mut a, mut b) = (vec![0u8], vec![1u8]);
    *pick(&mut a, &mut b) = 7;
    assert_eq!(hashed(&HashMap::new()).len(), 0);
    assert_eq!(r#match(3), 3);
    assert_eq!(fib(10), 55);
    let x = 5u8;
    assert_eq!(unsafe { raw(&x) }, 5);
    assert_eq!(exported(1), 2);
    assert_eq!(constant() + forced() + from_macro() + only_prod(), 18);
    assert!(!located().is_empty());
    assert_eq!(diverges_with_panic(false), 1);
    let _ = asynchronous();
    if h.len() == 99 {
        never_returns();
    }
    Ok(())
}
