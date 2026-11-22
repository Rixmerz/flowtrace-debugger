//! Panics.
//!
//! A panic is not a returned value, so the span guard learns about it from
//! unwinding: its `Drop` runs while `thread::panicking()` is true. What the
//! guard cannot know is the message, so a chained panic hook stashes it in a
//! thread-local (the hook runs on the panicking thread, before unwinding
//! starts). The previous hook still runs: the program's own panic output is
//! unchanged.
//!
//! Known limit: `Drop` code that runs *during* unwinding and calls an
//! instrumented function sees `panicking() == true` too, so that call is
//! reported as a panic even if it returns normally.

use std::cell::RefCell;
use std::panic::PanicHookInfo;

#[doc(hidden)]
pub struct PanicInfo {
    pub msg: String,
    pub stack: Vec<String>,
}

thread_local! {
    static LAST: RefCell<Option<PanicInfo>> = const { RefCell::new(None) };
}

fn message(info: &PanicHookInfo<'_>) -> String {
    let p = info.payload();
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "Box<dyn Any>".to_owned()
    }
}

pub(crate) fn install_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mut stack = Vec::new();
        if let Some(l) = info.location() {
            stack.push(format!("panicked at {}:{}:{}", l.file(), l.line(), l.column()));
        }
        // Frames follow Rust's own convention: only with RUST_BACKTRACE=1 (or full).
        // Rendering them symbolises the whole stack, which costs milliseconds per
        // panic: a test suite that panics on purpose would pay it hundreds of times.
        let bt = std::backtrace::Backtrace::capture();
        if bt.status() == std::backtrace::BacktraceStatus::Captured {
            stack.extend(bt.to_string().lines().map(|l| l.trim_end().to_owned()).take(19));
        }
        LAST.with(|c| *c.borrow_mut() = Some(PanicInfo { msg: message(info), stack }));
        // The buffered trace is the evidence; make sure it survives an abort.
        crate::flush();
        previous(info);
    }));
}

/// The message and stack of the panic this thread is unwinding from. Cloned, not
/// taken: every span the panic unwinds through reports the same panic.
pub fn current() -> Option<PanicInfo> {
    LAST.with(|c| c.borrow().as_ref().map(|i| PanicInfo { msg: i.msg.clone(), stack: i.stack.clone() }))
}
