# Rust capture layer

flow: flowtrace-rust-capture

This repository has no `openspec/` directory, so this file is the change record,
in the shape of `2026-08-27-go-capture-layer.md`.

## Why

FlowTrace supports Java, Python, Node/TS, Go and the browser. Rust was removed
in v2.0.0 with the rest of v1 — the v1 Rust agent emitted no `trace_id` /
`span_id`, so nothing in the v2 pipeline could read it — and nothing replaced
it. The first target is a real many-crate workspace (kernodb: storage engine,
search, Python and Node bindings that call Rust over FFI), to profile its storage
and search hot paths with the same CLI, dashboard and MCP tools the other
languages use.

Rust is statically compiled with no import hook, module loader or bytecode agent,
like Go, so instrumentation has to happen at or before compile time. Unlike Go it
has a compiler-wrapper seam (`RUSTC_WORKSPACE_WRAPPER`) and a very large
ecosystem that already emits spans (`tracing`). Both shaped the design.

## Two entry points, one writer

| | `flowtrace run -- cargo ...` | `flowtrace-tracing` layer |
|---|---|---|
| Edits your source | never | never, but you add the layer to your own subscriber |
| Needs the program to use `tracing` | no | yes |
| What is traced | every function of the workspace crates under the prefix | the spans the program already has |
| Arguments / results | rendered from the real types | the span's fields (`#[instrument(ret)]` for a result) |
| Cost | see "Measured overhead" | the program's own `tracing` cost, plus one extension per span |

Both write through one function (`flowtrace::event`), so the line shape, the
truncation rule, redaction, the event cap and the buffering cannot drift apart.
The runtime crate has **no dependencies**: it is linked into the traced
program, so a dependency there is a dependency of every user.

## Design decisions

### D1 — a `rustc` wrapper over a shadow copy, not `#[instrument]`, a proc macro or a `Cargo.toml` edit

Rejected, and why:

- **Apply `#[tracing::instrument]` automatically.** It needs `Debug` on every
  argument (the build breaks on the first type without one), it adds a `tracing`
  dependency that collides with the user's own version, and a subscriber has to
  be installed — which panics in programs that install their own
  (`kerno-server` does).
- **A `#[flowtrace::trace]` proc macro spliced onto every `fn`.** It still
  requires a dependency in every member's `Cargo.toml`, so the manifests (and
  the lock file) would have to be edited.
- **Edit the sources in place and restore them.** Writes to the user's tree.

Chosen: `RUSTC_WORKSPACE_WRAPPER`. Cargo runs the wrapper instead of `rustc`
for **workspace members only**, which is exactly the filter wanted: dependencies
from crates.io or outside the workspace compile untouched. For each crate the
wrapper mirrors the package's `src/` into a *shadow tree* under
`<target>/flowtrace-<hash>/shadow/`, rewrites every `.rs` file there, links
everything else in the package with symlinks (so `include_str!("../README.md")`,
`#[path]` and `mod` resolve exactly as before), and runs the real `rustc` on the
shadow root with `--extern flowtrace=<rlib>`. The user's tree is never written
to, and no manifest changes. Three details that were bugs before they were
decisions:

- `--remap-path-prefix <shadow>=<original>` makes panics, `file!()` and debug
  info name the original file.
- cargo decides what is stale from the dep-info (`.d`) file, which would list
  shadow paths and so never notice an edit to *your* sources. The wrapper
  rewrites the `.d` file back to original paths. Without this, editing a file and
  re-running served the old trace. (Verified: rename a function, rebuild, the new
  name appears.)
- cargo's fingerprints do not know the wrapper or the prefix changed, so every
  `(prefix, wrapper build)` pair gets its own build directory.

A configured `sccache` (`build.rustc-wrapper`) would sit in front of the
wrapper and cache an uninstrumented artifact under an instrumented name, so the
driver sets `RUSTC_WRAPPER=` empty for the instrumented build.

### D2 — byte-splice at AST offsets; the body goes in a closure

As in Go: `syn` locates each body's braces, and text is spliced in with no
newline, so **line numbers are unchanged**. Each instrumented body becomes

```rust
{ static META; let g = enter(&META, args); let r = call(move || -> Ret { BODY }); g.finish(&r); r }
```

The closure has the function's own return type, so `return` and `?` still leave
the function and the value that comes out is the one reported — this is how an
`Err` propagated by `?`, which is how most Rust errors surface, reaches the
trace. A `Drop` guard alone cannot see it. Details that matter:

- `call` takes an `FnOnce`, which makes the closure one. Without it, a
  `&mut self` method returning `&mut T` fails with "captured variable cannot
  escape `FnMut` closure body" — found by the first fixture, then fixed once, in
  the shared splice.
- `-> impl Trait` and `-> !` cannot be written in a closure's return type, so
  those get the guard only: enter, exit, duration and panic, no result.
- Not instrumented: `async fn` (a per-thread span stack is wrong across
  `.await`), `const fn`, `#[test]`/`#[bench]`, `#[inline(always)]`,
  `#[track_caller]` (a closure would change `Location::caller()`),
  `#[cfg(test)]` items, bodiless trait methods, edition-2015 crates.
- Methods of `Debug`, `Display`, `Drop`, `Clone`, `Iterator`, operator traits and
  similar impls are skipped: they are called from the runtime's own formatting
  and would recurse, or are hot and mechanical enough to drown a trace. A
  thread-local re-entrancy guard backs this up for the cases the list misses.
- If rustc rejects the instrumented copy of a crate, that crate is built
  untouched and a warning names it. Instrumentation is best-effort; the build is
  not. `tests/corpus` builds ~40 function shapes (generics, `&mut` returns,
  `extern "C"`, `unsafe fn`, lifetimes, raw identifiers, macro-defined fns...)
  and fails if the fallback ever fires.

### D3 — a failed call is an `exit` with `error`; a panic is one too

`Err(e)` → `error: {type: type_name::<E>(), msg: e.to_string(), stack: []}` with
`result: {}` (the schema requires `result`). A panic → `type: "panic"` with
the message and location. The span guard learns of a panic from `Drop` running
while `thread::panicking()`; a chained panic hook stashes the message (the
previous hook still runs, so the program's own panic output is unchanged). The
frames are added only with `RUST_BACKTRACE=1`, Rust's own convention, because
rendering them symbolises the whole stack.

Known limit: `Drop` code that runs *during* unwinding and calls an instrumented
function sees `panicking()` true, so that call is reported as a panic.

### D4 — values are rendered by what the compiler can prove

The splice cannot see which traits a type implements, so it uses autoref
specialisation: numbers, bools and strings become JSON natively, anything with
`Debug` becomes a string, anything else becomes `"<type::Name>"`. For
`Result<T, E>` the error side prefers `Display` over `Debug`. Inside a generic
function only the declared bounds are visible, so `T` with no `Debug` bound
renders as its type name. Redaction (by argument name, before rendering: a
secret is never formatted; and by nested field or map key inside the `Debug` text
of an argument or result, at any depth) and truncation follow
`TRUNCATION_SYSTEM.md`, with the one difference that the limit counts bytes of
the JSON, as in Go,
and a `Debug` impl that panics costs the value, not the program.

### D5 — context is a per-thread stack; `FLOWTRACE_TRACEPARENT` seeds roots

The first span on a thread reads its parent from `FLOWTRACE_TRACEPARENT`
(strict W3C, lowercase hex, all-zero ids rejected) and every later root joins the
same trace. `flowtrace::remote_context(header)` is the per-call counterpart and
`current_traceparent()` the outbound half, both manual — the Python layer's shape.

**Not propagated automatically, and not claimed to be:** a span started on a new
thread (`std::thread::spawn`, `tokio::spawn`) is a root with a new `trace_id`,
because Rust has no ambient context across threads or `.await`; inbound HTTP has
no seam (the transport is the program's own crate); and for a Rust library
called in-process over FFI, the env variable is read once, so roots hang off the
process-level span unless the Rust side calls `remote_context` with a header the
caller hands it. The cross-process test (`flowtrace-rust/tests/cross_process.rs`:
instrumented Python spawns an instrumented Rust binary with
`FLOWTRACE_TRACEPARENT=current_traceparent()`) asserts one `trace_id`, the Rust
root's `parent_id` equal to the Python span, and — as a control — that without
the variable the ids differ.

### D6 — buffered writes, an event cap that cannot forge an unreturned call

Go writes every event straight to the OS. A storage hot loop makes millions of
calls, so this layer buffers (64 KiB) and flushes when a root span closes after
50 ms idle, from the panic hook, and from `atexit`. The cost: a process killed by
`SIGKILL` loses up to one buffer; `FLOWTRACE_SYNC=1` writes every event.
`FLOWTRACE_MAX_EVENTS` (default 100000, `0` = none) only stops *new* spans from
opening; a span whose `enter` was written always gets its `exit`, because
`enter` without `exit` is what every consumer reads as "never returned" (copied
from Go, with a test).

### D7 — what is *not* done

- Windows hosts: the shadow tree is made of symlinks. Refused with a message.
- `--target` cross builds: the runtime is built for the host. Refused.
- Automatic context across threads / `.await`; `async fn` spans.
- A C ABI for FFI callers to hand a `traceparent` to Rust. The Rust side can call
  `remote_context` itself.

## Measured overhead

`benchmarks/rust/run.sh`, median of 5, release build, this machine (a noisy
desktop: run-to-run spread is about ±30%). Instrumented runs write to
`/dev/null` with the event cap off, so this is FlowTrace's own cost and not the
disk's. Baseline is the same code built plainly. Each "call" is one function
call = one `enter` + one `exit`.

| workload | baseline | instrumented | `FLOWTRACE_CAPTURE_ARGS=0` | past the 100k-event cap |
|---|---|---|---|---|
| trivial fn, each call a root span | 1.2 ns | 538 ns | 308 ns | 12 ns |
| trivial fn, nested under one root | 1.6 ns | 447 ns | 302 ns | 12 ns |
| point-read-like call (2 spans, ~70 ns of work) | 73 ns | 1010 ns | 698 ns | 90 ns |

How to read it: a traced call costs roughly **300 ns with no values and 450–540
ns with one argument and a result**, i.e. ~150–250 ns per event. For a function
that does 10 µs of work that is under 5%; for a function that does 1 ns of work
it is a ~300× slowdown, which is the worst case rather than a representative one.
Past the cap the cost drops to ~12 ns per call (one relaxed load).

Consequences for profiling (the stated goal):

- Narrow the prefix to the module under study (`--package-prefix
  kerno_storage::sst`); instrumenting every function of a storage engine buries
  the signal in nanosecond helpers and hits the cap in under a second.
- `FLOWTRACE_CAPTURE_ARGS=0` for timing; values for debugging.
- Use `--release`. In a *debug* build the cost is much higher on call-heavy code:
  kernodb's `kerno-storage` unit tests (127 tests, 624 functions instrumented)
  went from 4.1 s to 23 s, mostly the unoptimised closures around tiny calls.
- Not profiled with a sampling profiler (none was available here); the
  remaining cost is split roughly evenly between building the event and the
  per-call bookkeeping. There is room left (cached ids, a thread-local line
  buffer per span), unclaimed.

Event size is ~300–500 bytes: kernodb's 100,052 events were 47 MB.

## Verification

- `make test-rust`: runtime unit tests (nesting, schema keys, rendering tiers,
  redaction, truncation, panics, remote context, re-entrancy, threads, the cap,
  env seeding), layer tests, rewriter tests, the corpus build, the Python→Rust
  cross-process test.
- Golden: `examples/golden/rust` (two-crate workspace: a bin calling a lib; a
  returned `Err`, a `?` path, a recovered panic, a redacted argument, a generic
  fn, a `&mut` return, a thread) and `examples/golden/tracing/rust` (the layer).
  Both pass `make validate-schema` and `make check-golden`.
- kernodb: `flowtrace-rust --package-prefix kerno_storage cargo test -p
  kernodb-storage --lib` — 624 functions instrumented, 127 tests pass, the
  resulting 100,052-event file opens in the MCP server and answers
  `log_aggregate` (slowest `kerno_storage::deleter::run` ...),
  `trace_find_error` (a real `kerno_core::error::Error`) and `trace_tree`.
  The kernodb tree was not modified.
- Not verified here: the 1.81 minimum on an actual 1.81 toolchain (CI has a job
  for it), macOS, and in-process FFI through a `cdylib`.
