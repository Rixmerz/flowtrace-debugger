# FlowTrace — Go capture layer

Instruments a Go module so every function and method under a package prefix
emits FlowTrace v2 `enter`/`exit` events (`schema/flowtrace-v2.json`) to a
JSONL file — with **no change to the user's source tree and no dependency
added to their `go.mod`**. It is what `flowtrace run --lang go -- go run .`
drives. Design record: `docs/changes/2026-08-27-go-capture-layer.md`.

## How it works

Go has nothing to hook at runtime — no import hook, no module loader, no
bytecode agent — so the rewrite happens *before* the compiler, per build:

1. **Enumerate.** `cmd/flowtrace-go` runs `go list -json ./...` in the target
   module and keeps the packages selected by `FLOWTRACE_PACKAGE_PREFIX`
   (below). Dependencies are never instrumented.
2. **Rewrite into a scratch dir.** `transform/` parses each `.go` file and
   byte-splices one line of instrumentation right after every function's
   opening `{` — an `Enter` call and a `defer` that reports `Exit` or, on a
   recovered panic, `ExitPanic` (then re-panics, so behaviour is unchanged).
   The AST is used only to find offsets; nothing is pretty-printed, no newline
   is ever inserted, so every line number — and every stack trace — stays
   exactly where it was. Unnamed results are given generated names so the
   deferred exit can read them.
3. **Inject the runtime.** `flowtracert/` is copied byte-for-byte into the
   scratch dir as **`<module>/internal/flowtracert`** — a package of the
   user's *own* module as far as the compiler is concerned. It therefore
   needs no `require`, no `go.sum` entry, no network access. It exists only
   for the duration of the instrumented build.
4. **Build through an overlay.** An `-overlay` manifest maps every original
   path to its rewritten copy (and synthesizes the runtime package, which
   never exists on disk in the user's tree), and the user's own
   `go run` / `go build` / `go test` is exec'd with it. Exit code is passed
   through untouched. A user-supplied `-overlay` is merged, not replaced.

The scratch dir lives under `os.MkdirTemp` with `0700`/`0600` permissions and
is removed when the build ends.

## Requirements: Go 1.24 or newer — both the toolchain and the module's `go` directive

Span context has to survive a bare `go f()` statement without rewriting it
(rewriting would change *when* `f`'s arguments are evaluated). The only thing
in Go that the runtime copies from parent to child goroutine for free is the
pprof label slot, so `flowtracert` stores its active `*Span` there via the
same `//go:linkname` pair `runtime/pprof` uses. `runtime/pprof` casts that
slot to `*labelMap`, and `labelMap` is `struct{ list []label }` **only from
Go 1.24**; before that it is a `map[string]string`, and a `*Span` there
crashes the profiler the first time anything profiles the program. There is
no safe degraded mode, so the driver refuses to run below 1.24 — checking the
`go` binary that will actually build the overlay *and* the target module's
own `go` directive, because the injected package compiles under the target's
language version. `flowtracert.Span` must keep `list` as its first field for
the same reason; see the comment on the struct before touching it.

## Environment knobs

| Variable | Effect | Default |
|---|---|---|
| `FLOWTRACE_OUTPUT` | Path of the JSONL trace. | `.flowtrace/<yyyymmdd>T<hhmmss>.<ms>-<pid>.jsonl`, relative to the traced process's cwd (the CLI always sets this) |
| `FLOWTRACE_PACKAGE_PREFIX` | Comma-separated import-path prefixes to instrument. A package is selected when its import path **equals** a prefix or sits **under** `prefix + "/"` (`example.com/app` does not select `example.com/apparel`). Read by the driver at build time; it prints one line saying how many packages were selected. | unset = every package of the main module (the CLI passes the module path, which selects the same set) |
| `FLOWTRACE_MAX_ARG_LENGTH` | Per-value limit, in characters of the **JSON** form, above which an argument or result is replaced by `<truncated:{first N chars}...>`. Applies to `args` and `result` independently. `0` disables. | `512` |
| `FLOWTRACE_MAX_EVENTS` | Cap on `enter` events one process writes; a hot Go program can otherwise fill a disk. When hit, one stderr line reports the count and no further calls are *entered*; calls already open still get their `exit`, so `enter` without `exit` keeps meaning "this call never returned". `0` or negative disables. Read once, on the first event. | `100000` |
| `FLOWTRACE_REDACT_KEYS` | Extra comma-separated substrings (case-insensitive) matched against argument names, result names, struct fields and map keys; a match is emitted as `"<redacted>"`. **Additive** to the built-in list `password, secret, token, authorization, api_key, url, dsn, connection_string, email`. | built-in list only |
| `FLOWTRACE_TRACEPARENT` | W3C `traceparent` header value; when set, the process's root spans join that trace instead of minting a new `trace_id`. | unset |

Redaction runs before truncation. Serialization uses reflection only and
never calls a method on the user's value (no `String()`, `Error()` or
`MarshalJSON`), so tracing cannot take a lock the traced function already
holds; the one exception is `Error()` on a returned error or panic value,
which runs with a deadline and a per-type circuit breaker.

## Trace context propagation

- **Inbound over HTTP is automatic.** The transformer recognises every
  `func(http.ResponseWriter, *http.Request)` (by resolving the real `net/http`
  import, not by name) and seeds the handler's span from the request's
  `traceparent` header before its own `Enter`. Handler arguments are recorded
  as `http.method` / `http.path` only — never the request itself, which would
  put `Authorization` and `Cookie` headers on disk.
- **Inbound for any other entry point** is `FLOWTRACE_TRACEPARENT`.
- **Outbound is manual — there is no automatic hop.** `net/http` resolves at
  compile time and the injected runtime has no seam into it, so a Go client
  does **not** add `traceparent` to the requests it makes. If the callee is
  also traced, the user's code has to put the header on the request itself;
  otherwise the two processes produce two traces that look correct
  individually and only turn out to be split when the ids are compared.

## What the events look like

`module` is the package import path, `class` the receiver type (`""` for a
package-level function), `visibility` follows Go's export rule, `thread` is
`goroutine-<id>`, and `args` is keyed by parameter name.

**Results are keyed by their declared names when the function names them,
and positionally otherwise:**

```go
func Divide(a, b int) (quotient int, err error)   // result: {"quotient": 2, "err": null}
func Parse(s string) (int, error)                 // result: {"r0": 42, "r1": null}
func Lookup(k string) (v int, _ error)            // result: {"v": 1, "r1": null}
```

Redaction and truncation apply to a result by that key exactly as to an
argument by its name, so a result named `password` is `"<redacted>"`.
A returned non-nil `error` — or a recovered panic — makes the `exit` carry
an `error` object (`{type, msg, stack}`); there is no separate error event.

## Never import `flowtracert` from your own code

`<module>/internal/flowtracert` exists **only inside an instrumented build**.
It is synthesized through the overlay and is not on disk, so any file of
yours that imports it compiles under `flowtrace run` and breaks your plain
`go build`. Everything FlowTrace needs on the request path (the HTTP
`traceparent` seed above) is injected by the transformer for that reason. If
you find yourself wanting a call into the runtime, the right change is to the
transformer in this directory, not to your program.

Every non-test file in `flowtracert/` starts with `// SPDX-License-Identifier: MIT`
because it is copied into third-party modules; the package must stay
stdlib-only and compile under the target's `go` directive (1.24+), not this
repository's.

## Layout and tests

| Path | Role |
|---|---|
| `cmd/flowtrace-go/` | Driver: `go list`, prefix selection, staging, overlay manifest, exec. |
| `transform/` | AST-offset byte-splicer; `testdata/<case>/{input,want}.go` are its goldens and are compiled for real in `TestGoldenCompiles`. |
| `flowtracert/` | The injected runtime: emitter, span context, serialization, traceparent. |

```bash
cd capture/go && go vet ./... && go test ./... && go test -race ./flowtracert/
node scripts/check-golden.mjs go truncation/go error/go   # end-to-end, from the repo root
```
