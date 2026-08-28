# Go capture layer

flow: flowtrace-go-capture

## Why

FlowTrace supports Java, Python, Node/TS and the browser. Go was removed
wholesale in v2.0.0 along with Rust/.NET and the rest of v1 — the v1 Go agent
emitted no `trace_id`/`span_id`, so nothing in the v2 pipeline could read a
line of its output. Nothing replaced it. This adds Go back as a real v2
capture layer, held to the same contract as the other three: schema-v2 JSONL,
W3C trace context, no source modification by the user.

Go is structurally unlike the three existing layers, and the reason drives
every decision below: it is statically compiled with no import hook (Python),
no module loader (Node) and no bytecode agent (Java). There is nothing to hook
at runtime. Instrumentation has to happen at or before compile time.

## Design decisions, each measured rather than assumed

Verified locally against Go 1.25.0 (darwin/arm64). Where a decision reverses
an earlier draft of this document, that is called out — the reversals are the
useful part.

### D1 — inject via `go build -overlay`, not by copying the module

`-overlay` maps original file paths to replacement files. Measured, it does
two things, not one:

- replaces an existing file with a rewritten version, **and**
- **synthesises a package that does not exist on disk** — a fixture importing
  `ovtest/internal/ftrt` built and ran with that directory never created.

After the build the module tree held only its original two files. Nothing is
written into the user's tree.

The consequence that matters: the runtime is injected as
`<user-module>/internal/flowtracert` — a package of the user's *own* module as
far as the compiler is concerned. So it needs **no `require`, no `replace`, no
`go.sum` entry, no network fetch, and no `go.mod` edit**. It exists only for
the duration of the instrumented build.

Copying the module was the earlier draft's plan and is worse on every axis:
`//go:embed` needs the whole tree, `vendor/` has to come along, and a relative
`replace ../helper` directive breaks outright once the module sits at a
different depth.

### D2 — byte-splice using AST offsets; do **not** print a mutated AST

This reverses the earlier draft. That draft verified `go/printer` round-trips
an **unmutated** AST byte-identically (it does — with `//go:build`,
`//go:generate`, `//go:noinline`, struct tags and generics all intact) and
wrongly generalised that to mutated ASTs. Printing a *mutated* AST re-places
comments by absolute position and **shifts line numbers**, so every stack
trace in the traced program starts pointing at the wrong line — a debugger
that makes stack traces lie is worse than no debugger.

Instead: use the AST **only** to locate `FuncDecl.Body.Lbrace` offsets, then
splice text into the original bytes back-to-front. Inserting immediately after
`{` with no newline preserves every line number exactly.

Combined with D1 this measured clean: a panic in an overlaid, byte-spliced
file reported the **original absolute path at the correct original line**. No
`//line` directives are needed — an advantage over `-toolexec`, which compiles
from a temp objdir and must synthesise `//line` to undo the path damage.

### D3 — goroutine context via the pprof label slot, not stack parsing

The earlier draft proposed discovering goroutine parentage by parsing
`created by <fn> in goroutine M` out of `runtime.Stack`. That works — verified
two levels deep — but it is the wrong mechanism:

| approach | ns/op | inherits across a plain `go`? |
|---|---|---|
| pprof label slot (`g.labels`) | **~1** | **yes, by the runtime itself** |
| goid libraries | 1–2 | no |
| `runtime.Stack` parse | 1,323 shallow → **14,402 at depth 50** | no |

`runtime.Stack` costs a full `traceback()` regardless of buffer size, so it
scales with call depth — the opposite of what a per-call hook needs. The
`goroutine N [running]` header is also explicitly outside the Go 1
compatibility promise.

`newproc1` copies `g.labels` from parent to child for user goroutines. That is
the only mechanism in Go that propagates across a bare `go` statement with no
change to user code, which is exactly the constraint: rewriting `go f(a, b)`
into a closure would change *when* `f`, `a` and `b` are evaluated (Go
evaluates them in the calling goroutine), and a tracer must not change the
semantics of what it traces.

Verified end-to-end: three concurrent goroutines nested correctly, a child's
push not leaking back into the parent, grandchildren inheriting.

**Hard safety requirement, and a floor this document originally got wrong.**
`runtime/pprof` casts `g.labels` to `*labelMap`. The assumption that
`labelMap` is `struct{ list []label }` — which the rest of this section, and
the Span struct, are built on — only holds **from Go 1.24**. In Go
1.21/1.22/1.23, `labelMap` is `map[string]string`: a map header, not a
struct we can lead a compatible field with. Storing our `*Span` in the label
slot on one of those versions hard-crashes the profiler the first time a span
has a non-nil parent (`SIGSEGV ... runtime/pprof.(*profileBuilder).build`,
reproduced with `GOTOOLCHAIN=go1.23.0`) — it will not surface in ordinary
testing and will surface the first time someone profiles a real workload.

**Decision: raise the floor to Go 1.24, not a degraded pre-1.24 path.** A
`map[string]string` slot gives no safe way to store a differently-shaped
pointer, and building a real degraded mode (no cross-goroutine inheritance
below 1.24) would mean maintaining and testing two behaviourally different
context-propagation implementations for a mechanism D3 exists entirely to get
right. `capture/go/go.mod` now declares `go 1.24`, the CI matrix
(`.github/workflows/v2-ci.yml`) tests `['1.24', '1.25']`, and
`cmd/flowtrace-go` fails fast and loud — before touching a single file — if
the `go` binary that will actually build/run the overlay resolves below
1.24 (`checkGoToolchainVersion` in `main.go`; this is defense in depth
alongside the `go.mod` floor itself, which already refuses to build
flowtrace-go's own driver under an older pinned toolchain). Never a silent
crash, on any Go version.

The span struct must therefore lead with a `list []label` field. Go 1.26
added `GODEBUG=tracebacklabels` and 1.27 makes it the default, which means the
**panic printer** dereferences that slot too — a wrongly-shaped pointer would
fault inside the crash handler.

### D4 — `recover` + re-`panic` per frame is affordable

Measured with three nested instrumented frames: Go 1.25 collapses the repeats
into one `panic: boom [recovered, repanicked]` header with the original
message intact, adding one interleaved `panic(...)` frame per level. Not the
wall of noise that would have forced a weaker, value-less panic capture.

## In scope

### AC1 — a Go module traces end to end, without the user editing a line
New `capture/go/`: one Go module holding (a) `flowtracert/`, the package
injected into the target, and (b) a transformer plus a `cmd/` entrypoint the
Node CLI shells out to. `flowtrace run --lang go -- go run ./cmd/api` enumerates
packages via `go list -json ./...`, byte-splices each matching file into a
work dir, synthesises the runtime package, writes an overlay manifest, and
execs `go run -overlay <manifest> ...`.

Each instrumented `FuncDecl` gains named results (reusing existing names,
generating them where absent, renaming blank `_` results), an enter call, and
one `defer` emitting the exit — capturing returned values, a non-nil `error`,
or a `panic` (re-raised after capture).

**Zero non-stdlib dependencies** in both the transformer and the injected
runtime, so tracing never triggers a module download and can never conflict
with the target's dependency graph.

AC: a demo module with a struct method, a package-level function, a non-nil
error return, a panic recovered upstream, and a spawned goroutine produces a
`flowtrace.jsonl` where every line validates against schema v2, `enter`/`exit`
pair up, and the goroutine's span carries the spawning function's `span_id` as
`parent_id` within the same `trace_id`.

### AC2 — schema v2 admits `go`
`schema/flowtrace-v2.json`'s `lang` enum is a closed
`["java","python","node","ts"]`; a Go event fails validation today, and the
dashboard collector enforces it on every POST. Add `"go"` — additive, every
previously-valid document stays valid, so not a v3. Update the CLI help text,
`SUPPORTED_LANGS`, and `detectLang` (a `go.mod` means Go; its `module` line
gives the prefix, as `pom.xml`'s `groupId` already does).
AC: `make validate-schema` passes with a Go fixture; `flowtrace init` in a Go
module reports `lang: go` and the module path as prefix.

### AC3 — mapped onto the v2 field contract the way Go actually is
- `class` — receiver type for a method (`*Calc` → `Calc`, `*Repo[T]` →
  `Repo`), empty for a plain function. Lands on the module-level-function path
  fixed earlier today, so these render by module rather than as `Unknown`.
- `module` — the package's import path relative to the module root.
- `visibility` — exported → `public`, else `private`. Go has no third case, so
  `internal`/`unknown` are never emitted.
- `thread` — `goroutine-<id>`.
- `error` — populated for **both** a `panic` and a returned non-nil `error`.
  Returning an error is ordinary control flow in Go rather than an exception,
  so this is deliberate: a returned error is what a Go developer is debugging,
  and `trace_find_error` finding it is the point of the field. Documented as
  Go-specific behaviour in the CHANGELOG.
AC: runtime unit tests pin each mapping; the golden fixture locks event shapes.

### AC4 — argument capture must not be able to hang the traced program
`json.Marshal` on an arbitrary user value invokes that value's `MarshalJSON` —
user code running inside the tracer. If it takes a lock the traced function
already holds, FlowTrace deadlocks the program it is debugging. Capture must
therefore use depth-limited `reflect` that **never invokes user methods**,
falling back to a type name. Reuse the existing `FLOWTRACE_MAX_ARG_LENGTH` and
`FLOWTRACE_REDACT_KEYS` contracts (redaction defaults included) so Go behaves
like the other layers.
AC: a fixture whose argument type has a `MarshalJSON` that takes a mutex held
by the caller traces without deadlocking; redaction and truncation tests match
the Python suite's cases.

### AC5 — the limits are enforced, not discovered later
Skip, do not mangle: files importing `"C"` (cgo), `_test.go`, declarations
with no body (assembly — `fd.Body == nil`), and any file that fails to parse
(leave the original, warn, continue — a tracer must never break the build it
was pointed at). Generated files must not be named with a leading `_` or `.`;
the go tool ignores those silently.
Two limits get documented rather than fixed: `defer` makes every instrumented
function permanently non-inlinable (measured: a 0.23 ns inlined leaf becomes a
real call at ~35 ns, of which ~19 ns is the two clock reads), and GCshape
stenciling means generic instantiations share one span name.
AC: a fixture module containing a cgo file, a `_test.go` and a bodiless
declaration transforms without error, leaves those untouched, and still builds
and runs.

### AC6 — wired into the repo's existing machinery
`make build-go` / `make test-go` in the `test` aggregator; a `golden/go`
fixture in `scripts/golden/runners.mjs` so `check-golden` and
`validate-schema` cover Go like every other layer; a Go job in
`.github/workflows/v2-ci.yml`; `capture/go` vendored by
`flowtrace-cli/scripts/vendor.mjs` as the Python runtime already is.
AC: `make test` runs the Go suite and fixture; a packed tarball contains the
Go capture layer.

## Out of scope

- `-toolexec` instrumentation (orchestrion's approach). Its decisive advantage
  is reaching **dependencies and the stdlib**, which is out of scope here —
  every FlowTrace layer scopes to the user's own code by prefix. It also
  carries a failure mode overlay does not: `-toolexec` is not part of the
  build cache key, so a later plain `go build` can silently return the
  *instrumented* binary (verified) unless the wrapper intercepts `-V=full`.
  Overlay changes file content, which cmd/go already hashes — measured, a
  plain build after an instrumented one correctly returned the original
  binary. Given this repo spent today fixing exactly one stale-cache-bypasses-
  instrumentation bug in Python, the approach without that class of bug wins
  for v1.
- Instrumenting `FuncLit` (closures). Common in Go, but skipping them does not
  break goroutine attribution, and naming them needs a `func.L<line>.C<col>`
  scheme. Follow-up.
- Cross-process propagation (`FLOWTRACE_TRACEPARENT` in/out).
- Rust/.NET, HTTP middleware, framework integrations.

## Risks accepted, and what would trigger a rethink

- **Go < 1.24 is not supported, full stop — this replaces an earlier, wrong
  assumption that D3 worked back to 1.21.** `runtime/pprof.labelMap` only has
  the `struct{ list []label }` layout the Span struct relies on from Go 1.24;
  before that it is `map[string]string`, with no safe way to store a
  differently-shaped pointer in it. `capture/go/go.mod` requires `go 1.24`,
  and `cmd/flowtrace-go` refuses to run — with a clear, actionable message —
  against any resolved toolchain below that, rather than building something
  that only crashes the first time a real workload gets profiled. A
  build-tag'd degraded mode for older Go (no cross-goroutine inheritance) was
  considered and rejected: it would mean shipping and maintaining two
  behaviourally different context-propagation implementations for the one
  mechanism D3 exists to get right.
- **The label slot is a single shared global.** If the target app or any
  dependency uses `pprof.Do`, `SetGoroutineLabels`, `cloudwego/localsession`
  or `timandy/routine`, we clobber each other — verified to produce a crash
  reading `0x726f7574696e65` ("routine"). Mitigation: chain rather than
  overwrite (preserve the inherited `list`), and detect a foreign non-nil
  label at startup and degrade loudly rather than crash.
- **Reading `g.labels` uses a deliberately unexported path.** The profile-
  labels design doc states the read path was withheld specifically to prevent
  goroutine-local storage. `runtime_setProfLabel` carries a hall-of-shame
  linkname the runtime commits not to break; the getter is less blessed. For a
  developer-facing debugger this fragility is affordable in a way it would not
  be for a library shipped into production — if it breaks on a future Go, we
  fix it. If it becomes unavailable, the degraded fallback is a goid library
  plus `created by` parsing: correct, far slower, no free inheritance.
- **Volume.** Every mature Go tracer instruments declared join points rather
  than every function; FlowTrace instruments everything under a prefix, as its
  other three layers do. Go programs run hotter than typical Python or Node
  ones, so an event cap is not optional — it belongs in v1, not after someone
  fills a disk. Implemented: `emitter.go` caps at 100,000 events per process
  by default (`FLOWTRACE_MAX_EVENTS` overrides it; 0 disables it), warns once
  on stderr when the cap is hit, and stops opening new spans after that
  warning — but a span already open when the cap was hit still gets its
  `exit` recorded (`Span.entered` tracks this), so the trace has no orphaned
  `enter` or `exit` in either direction. The file can therefore grow past
  the cap by up to the number of spans open at the moment it was hit; it
  never buffers unboundedly waiting to flush.
- **Goroutine pools defeat inheritance** — workers are created before the span
  exists, so pooled work attributes to whatever created the pool. Inherent to
  the mechanism; document it.

## Verification

- `cd capture/go && go test ./...` (transformer golden-file tests: input `.go`
  → expected output; runtime unit tests)
- `make validate-schema check-golden test-go`
- `make test` (full aggregate — nothing else regressed)
- Manual: trace a real third-party Go program, not only the fixture. This is
  the standard the Python and Java layers were held to earlier today, and it
  is what surfaced their real bugs in both cases.
