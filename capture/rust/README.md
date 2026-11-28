# FlowTrace — Rust capture layer

Three crates: `flowtrace` (the dependency-free runtime), `flowtrace-rust` (the
driver and `rustc` wrapper behind `flowtrace run --lang rust -- cargo run`) and
`flowtrace-tracing` (a `tracing_subscriber` layer for programs that already use
`tracing`). The design record is `docs/changes/2026-11-22-rust-capture-layer.md`;
the environment knobs are listed in `flowtrace/src/lib.rs`.

## Source location: `file` and `line`

Every `enter` event also says where its function is declared, so a static
index can join the span to the symbol. They are the last two keys of the line:

```json
{"event":"enter","module":"calc_core","class":"Calculator","method":"add", ..., "depth":2,"file":"calc-core/src/lib.rs","line":43}
```

- **`file`** is the original source file — never its copy in the shadow tree —
  as a forward-slash path **relative to the project root**. The root is the
  cargo workspace root (`workspace_root` of `cargo metadata`), so a member
  crate keeps its directory. Set **`FLOWTRACE_ROOT`** when the build is
  instrumented to use another directory instead, typically the repository root
  of a workspace that lives in a subdirectory; a relative value is resolved
  against `--dir`, and a value that is not an existing directory fails the
  run. A file outside the root is reported as an absolute path.
- **`line`** is the 1-indexed line of the `fn` keyword in the original file,
  taken from the parsed source, not from the rewritten text. Attributes and
  doc comments above the function do not count.

Both are compile-time literals: the rewriter splices
`Meta::located(module, class, method, visibility, file, line)` into the
function, and the runtime escapes them once per function, not per call. They
appear on `enter` only (an `exit` is paired by `span_id`), are never redacted
or truncated, and are omitted together when unknown. Because the root is
compiled in, the driver keeps one build directory per root: changing
`FLOWTRACE_ROOT` rebuilds rather than serving artifacts with the old paths.

### With `flowtrace-tracing`

The layer has no source to parse, so it reports what the span's callsite
recorded (`Metadata::file()` / `Metadata::line()`), which is weaker in two ways:

- `line` is where the `span!` or `#[instrument]` was written. For
  `#[instrument]` that is the **attribute's line**, one or more above the `fn`
  keyword, not the declaration line the rewriter reports.
- `file` is the path as cargo passed it to rustc. For a workspace member that
  is already relative to the workspace root and is emitted as recorded. Only an
  absolute path is rewritten: relative to `FLOWTRACE_ROOT` (read at run time
  here), else to the working directory, when it lies under it.
