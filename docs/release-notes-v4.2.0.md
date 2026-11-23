# FlowTrace v4.2.0 Release Notes

**Rust joins Java, Python, Node/TypeScript and Go as a traced runtime.**

---

## Highlights

- **Rust is a supported runtime.** `flowtrace run -- cargo run` (also `cargo build` and `cargo test`) builds your workspace instrumented. Requires Rust 1.81+ on a Unix host.
- **Nothing in your tree changes.** Each workspace crate's `src/` is mirrored into a shadow tree under `target/` and compiled from there. Your sources and manifests are not written to.
- **Errors and panics are recorded.** A returned `Err`, including one propagated by `?`, and a panic both become the call's `error` on its `exit` event.
- **`flowtrace-tracing`** for programs that already use `tracing`: a `Layer` that writes the same events.
- **Schema v2 is unchanged.** `lang` now also takes `"rust"`. No field was added or renamed.

---

## Breaking changes

None. The `lang` enum gained `"rust"`. Existing traces and consumers are unaffected.

---

## Using Rust

```bash
npm install -g @rixmerz/flowtrace@4.2.0
flowtrace run -- cargo run
```

Run in a crate with `fn add(a: i32, b: i32) -> i32` and a `main` that calls it, the program prints its own output, then `[flowtrace] instrumented 2 functions`. The trace is written to `.flowtrace/<timestamp>.jsonl`, one file per run. The `add` exit event, verbatim from a run of the installed 4.2.0 package:

```json
{"ts":1795408120.064085,"trace_id":"a305cec6985ae2814877445741a1f66a","span_id":"03a95bf620c82183","parent_id":"43ab7e11bd5bc84f","event":"exit","thread":"main","lang":"rust","module":"demo","class":"","method":"add","visibility":"private","args":{"a":2,"b":3},"result":{"r0":5},"duration_ns":3907,"depth":1}
```

An `Err` returned through `?` and a panic, verbatim exit events from a second crate (`parse` returns `Err`, `boom` indexes past the end of a slice). The sample's absolute path is shortened to `/path/to` here:

```json
{"ts":1795408145.803049,"trace_id":"6fbf4a463e0a86f6d99f26d52efa8e50","span_id":"88622d84a994d48b","parent_id":"141f88478e544311","event":"exit","thread":"main","lang":"rust","module":"demo2","class":"","method":"parse","visibility":"private","args":{"s":"x1"},"result":{},"error":{"type":"alloc::string::String","msg":"bad input x1: invalid digit found in string","stack":[]},"duration_ns":8726,"depth":1}
{"ts":1795408145.803326,"trace_id":"6fbf4a463e0a86f6d99f26d52efa8e50","span_id":"ffd078b7dbf9bc3e","parent_id":"141f88478e544311","event":"exit","thread":"main","lang":"rust","module":"demo2","class":"","method":"boom","visibility":"private","args":{"v":"[1, 2]"},"result":{},"error":{"type":"panic","msg":"index out of bounds: the len is 2 but the index is 9","stack":["panicked at /path/to/demo2/src/main.rs:9:5"]},"duration_ns":269827,"depth":1}
```

The panic's line and column are the real position of the failing expression. An `Err` reports the Rust type of the error value as `error.type`, not a fixed word. The program's own panic still ends the process with exit code 101; FlowTrace does not change it.

Limits, stated plainly:

- `async fn`, `const fn`, `#[test]`, `#[bench]`, `#[inline(always)]`, `#[track_caller]` and test-only (`#[cfg(test)]`) functions are not instrumented.
- A function whose body is on the same line as its braces (`fn one(x: i32) -> i32 { x + 1 }`) is not instrumented either. The driver prints a note naming the file and the count. Run rustfmt to bring it back.
- A span started on a new thread is a root with a new `trace_id`, on a thread named `thread-<n>`. Rust has no ambient context across threads or `.await`. Carry the header with `flowtrace::current_traceparent()` and reopen it with `flowtrace::remote_context()`.
- Inbound HTTP is not adopted automatically. `FLOWTRACE_TRACEPARENT` is honoured, and an FFI caller needs `remote_context`.
- `cargo test` traces only the functions a test calls. A crate with no traced calls writes an empty trace and a warning that names the package prefix in use.
- Unix hosts only: the driver refuses other hosts, because the instrumented tree is made of symlinks. `--target` cross builds are refused.
- Overhead is about 300 ns per traced call with no values, and 450-540 ns with an argument and a result (`benchmarks/results-rust-20261122T170119.json`). Set `FLOWTRACE_CAPTURE_ARGS=0` to drop argument capture; `args` is then empty.

Design, limits and measurements in more depth: [docs/changes/2026-11-22-rust-capture-layer.md](changes/2026-11-22-rust-capture-layer.md).

---

## Fixes since 4.1.0

- **The documented Rust minimum version is 1.81**, not 1.70. The runtime crate needs `PanicHookInfo`, so the MCP runtime registry would have listed toolchains that cannot build it.
- **Panic columns are exact.** A one-line function body used to have its prologue spliced after the opening brace, which moved the panic column (208 instead of 24). Such bodies are now left uninstrumented, and the driver says so.
- **The Java build could test and ship the previous release's jar.** `mvn package` does not clean `target/`, and the jar lookup matched by filename prefix and took the newest by mtime. The jar is now named by the pom, and an older version's jar is ignored rather than used.

Full list: [CHANGELOG.md](../CHANGELOG.md).

---

## Versions

| Component | Version |
|-----------|---------|
| `@rixmerz/flowtrace` (CLI) | 4.1.0 → 4.2.0 |
| FlowTrace Claude Code plugin and marketplace | 2.8.0 → 2.9.0 |
| `@flowtrace/mcp-server` | 2.2.0 → 2.3.0 |
| Rust capture layer (`flowtrace`, `flowtrace-tracing`, `flowtrace-rust`) | 0.1.0 (new) |
| Node capture | 2.2.0 (unchanged) |
| Python capture, Java extension | 2.2.0 (unchanged) |
| Go capture | no version, a module path only (unchanged) |
| `@rixmerz/flowtrace-browser` | 2.3.0 (unchanged) |
| Dashboard | 2.2.0 (unchanged) |

The CHANGELOG's [4.2.0] entry lists every manifest, including the ones that did not move.

---

## Acknowledgments

Rust support builds on the same trace contract as the other layers: schema v2, W3C trace context, and the golden fixtures that CI diffs on every change.
