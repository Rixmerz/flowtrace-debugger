# Changelog

All notable changes to FlowTrace.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the CLI (`@rixmerz/flowtrace`) version is the one these headings carry.
The capture layers, the plugin and `@rixmerz/flowtrace-browser` version
independently; each release names them.

## [Unreleased]

## [4.0.0] - 2026-09-03 — capture layers 2.2.0, browser 2.3.0, plugin 2.7.0

A repository-wide audit and the fixes it produced. Two of these crashed the
program being traced, and three were ways for a secret or a file to leave the
machine; the rest are the drift five parallel capture layers accumulate when
nothing compares them to each other.

### Security

- **The dashboard bound every network interface while every message it printed
  said "localhost".** Combined with the two findings below, anyone on the same
  LAN could read files off a developer's machine. It binds `127.0.0.1` now;
  `FLOWTRACE_DASHBOARD_HOST` widens it deliberately and prints a warning when
  it does.
- **`POST /api/analyze-file` read any `.jsonl` path on the machine.** It is now
  confined to allowed roots — the directory the server was started in plus
  `FLOWTRACE_DASHBOARD_ROOTS` — resolved through `realpath`, so a symlink
  inside a root cannot point outside it. Outside them it answers `403
  {code: "OUTSIDE_ROOTS"}` and `flowtrace analyze` uploads the file instead.
- **An upload was stored under the client's own filename**, which multer joins
  onto the upload directory: an `originalname` of `../../../.ssh/config` wrote
  straight out of it. Names are server-chosen UUIDs now, with a size cap, and
  uploads are deleted when their analysis is evicted.
- **The OpenTelemetry javaagent was downloaded and handed to the JVM with no
  integrity check.** That jar runs before the traced program's `main()`. The
  download is now verified against a pinned SHA-256 before it is put in place,
  redirects are followed only to `https`, and a stalled transfer times out.
  `scripts/fetch-otel-agent.sh` pinned a *different* version than the CLI did;
  both now pin one artifact and both verify it.
- **Node, Java and the browser layer redacted nothing.** Python and Go had a
  redact-key list; the same Express app traced through Node wrote every
  `password` and `Authorization` value into the file. All five layers share the
  list now, applied to `args` and `result` before truncation.
- The dashboard sends a strict Content-Security-Policy and serves a vendored
  Chart.js instead of an unpinned CDN script; the inline bootstrap moved to a
  file so `script-src 'self'` holds.
- The Python and Node transform caches — rewritten copies of the user's source,
  loaded as code — are created `0700`/`0600`. The Go overlay's staged sources
  were `0755`/`0644` in a shared `/tmp` and are now `0700`/`0600`.

### Fixed

- **An arrow function with a destructured parameter crashed the traced app.**
  `({a, b}) => …` compiled to code referencing an undeclared `arg0`, so the
  first call threw `ReferenceError`. Ubiquitous in Express and React code, and
  it failed at call time, which reads as a bug in the application.
- **The Python emitter raised into the traced program.** A write failure — an
  unwritable `FLOWTRACE_OUTPUT`, a full disk — propagated out of the `finally`
  the transformer injects into *every* function. Nothing in the instrumentation
  can raise into user code now; failures are counted and reported once.
- **Every instrumented Python function lost its docstring.** Wrapping the body
  in `try/finally` moved the docstring off the first statement, so `__doc__`
  became `None` — breaking doctest, `help()`, click/typer help text and FastAPI
  descriptions.
- **`sitecustomize` forced every traced Python run to exit 0** and skipped the
  program's `atexit` handlers (`logging.shutdown`, coverage's data write) via
  `os._exit(0)`. It now joins non-daemon threads, runs `atexit`, flushes and
  exits with the program's own status.
- **`flowtrace run` reported success for a crashed program.** A child killed by
  a signal gives Node `code === null`, and `process.exit(code ?? 0)` turned a
  SIGSEGV or an OOM kill into exit 0. It is `128 + signal` now.
- **`result` was never truncated in Node, Python or Java**, contradicting
  `TRUNCATION_SYSTEM.md`. **Java's marker was `...[truncated]`** where every
  other layer emits `<truncated:…...>`, and it measured `toString()` rather
  than the JSON form.
- **The dashboard counted an event variant that cannot exist.** `errorEvents`
  came from `event === "error"`, which schema v2 rejects, so it reported zero
  errors on every real trace.
- **`log_aggregate` with `op: "max"` crashed on any real trace.**
  `Math.max(...vals)` spreads the group into an argument list and overflows the
  call stack. Percentiles in the dashboard had the mirror-image defect: the
  index overshot and `|| 0` reported p99 = 0 for small samples.
- **The Node transform cache was never invalidated.** Its fingerprint was a
  hardcoded `2.0.0-alpha.1` at package version 2.1.0, so every transform fix
  since was invisible to anyone with a warm cache. It hashes the transform
  source now.
- **A path containing a space broke Node and JVM injection.** `NODE_OPTIONS`
  and `JAVA_TOOL_OPTIONS` are split on whitespace; the loader silently never
  registered, producing an empty trace.
- **`flowtrace run` ignored `.flowtrace/config.json`.** Only `lang` was read, so
  the prefix a user reviewed and `maxArgLength` had no effect at all.
- **A Gradle project could be initialised but not run**: `run` carried its own
  pom.xml-only prefix detector while `init` used one that handled both.
- **The Node package prefix was the npm package name**, but the layer matches it
  against the file path — so a project whose directory is not named after its
  package instrumented nothing. `init` and `run` now agree on the directory.
- Timer leak in Go's `safeErrorMessage` (one live `time.After` per
  error-returning call); `FLOWTRACE_MAX_EVENTS` re-read from the environment on
  every event under the emitter lock.
- Java: output written in the platform charset (non-ASCII produced invalid
  UTF-8); `NaN`/`Infinity` emitted bare, which no JSON parser accepts; one
  unserializable argument dropped the whole event; `traceparent` accepted
  uppercase, whitespace and a trailing `-` that every other layer rejects;
  `PendingThreadContext` pinned dead threads and their spans for the JVM's
  lifetime.
- Default trace filenames had second resolution in Python and Go, so two
  processes started in the same second appended to one file.
- The browser layer silently discarded a batch the collector never received;
  losses are counted and reported once, and an `https` page with a plaintext
  endpoint is warned about at setup instead of failing every flush in silence.
- `initFlowtrace` registered its listeners again on every call, doubling every
  unhandled error under hydration or HMR.

### Added

- **Go honours `FLOWTRACE_PACKAGE_PREFIX`** (exact import path or `prefix/…`),
  the one layer that instrumented everything regardless.
- **Go exit events key results by their declared names** — `{"quotient": …,
  "err": …}` rather than `{"r0": …, "r1": …}` — which also makes result
  redaction able to fire at all.
- `lang: "ts"` is emitted for TypeScript sources and `lang: "browser"` for the
  browser layer; both are in the schema enum. Node reports
  `thread: worker-<id>` inside a worker, and a worker joins the trace of the
  span that created it.
- Java: structural JSON for arguments and results (maps, collections, arrays,
  enums, `Optional`, bounded depth and width) instead of `toString()`; real
  parameter names where the class carries them.
- Python: `threading.Thread` inherits the starting span; fork-safe emitter.
- `log_open` reports size and field names and refuses a directory or a file
  over `FLOWTRACE_MCP_MAX_BYTES`; `log_aggregate` pages like `log_search`; an
  unknown field name is an error naming the closest real ones instead of a
  column of nulls.
- The dashboard analyzer reports **self time** (exclusive of children) beside
  inclusive duration, ranks hotspots by it, caps call trees at 2000 nodes, and
  flags spans whose parent is missing from the file rather than silently
  presenting them as roots.
- New golden fixtures `truncation/go` and `error/go`; a README for every
  capture layer; `SECURITY.md`; `.github/dependabot.yml`; ESLint and
  `.editorconfig`.
- CI: `make check-docs` now runs (it was in `make test` but in no job), a lint
  job, and wider matrices — Node 24, Python 3.14, Go 1.27.

### Changed

- **Python wraps every non-`None` return as `{"value": …}`.** A `dict` return
  was emitted unwrapped, so `{"value": 1}` returned by the program was
  indistinguishable from `1`. **Breaking for anything reading Python results.**
- `check-docs` covers `plugin/commands/trace.md`, the skill and the CLI README,
  and fails on a recommended `npx @rixmerz/flowtrace` — the shim abandoned npx
  because npm resolves config from the traced project's directory, so
  `devEngines.packageManager` made it fail in exactly the projects being traced.
- Package-level `test` scripts glob their directories; `mcp-server` and
  `flowtrace-dashboard` ran 1 of 3 and 1 of 4 files, `flowtrace-cli/Makefile`
  ran 2 of 13.
- The benchmark harness fails loudly instead of reporting 0% overhead for a run
  that never happened — which is how six all-zero results came to be committed.

### Removed

- `axios` from `mcp-server` (declared, never imported); Jackson from the
  shipped Java jar (test-only now).
- `.jig/`, eight committed trace files under `capture/node/.flowtrace/`, the
  zeroed benchmark results, two orphaned shell scripts, the
  `examples/nextjs-typescript/` README describing code that does not exist, and
  `docs/{en,es}/installation.md` (v1 throughout: Java 8, Node 14,
  `install-all.sh`, `flowtrace-agent.jar`).
- Five `.claude/skills/` packs for languages and domains this project does not
  have, and `.claude/rules/rust.md`.

### Documentation

- `ROADMAP.md` and `CONTRIBUTING.md` rewritten — both described v1: Python and
  Go "Not Started" while shipped and matrix-tested, `./install-all.sh`, `mvn
  test` in directories that no longer exist, and no mention of `make test`,
  the golden fixtures or the bundles.
- `TRUNCATION_SYSTEM.md` corrected (Go was missing, redaction was described as
  Python-only, the marker was presented as universal) and now states what the
  parity fixtures do *not* prove.
- `docs/architecture.md`: Java is a ByteBuddy rewrite carried by the OTel
  agent, not a `SpanProcessor`; `visibility` lists the schema's real enum.
  Historical design documents are labelled as such.
- The issue and PR templates ask for the package prefix and drop the removed
  Rust/.NET components; `CODE_OF_CONDUCT.md` has a real contact address.

## [3.4.0] — browser capture 2.2.0

### Fixed

- **The Angular interceptor broke every HttpClient call in an instrumented
  app.** `flowtraceInterceptor` returned the Promise from `traceHttp`, but an
  `HttpInterceptorFn` must return the Observable of `HttpEvent`s and Angular
  subscribes to whatever comes back. Nothing observable said so: the request
  went out, the server answered 200, the span was recorded correctly and the
  network tab was clean — while every caller's `subscribe()` landed on its
  error branch.

  It is now `pipe(tap(...))`, which returns Angular's own Observable with its
  identity intact. `from(promise)` would have fixed the crash and kept the
  sibling defect: nothing tears down the inner subscription, so a request the
  caller unsubscribed from keeps flying and every intermediate `HttpEvent` is
  swallowed. Six tests now assert on what the *caller* receives, with real
  rxjs — a stub Observable would have passed against the very Promise that
  shipped the bug.

  One behaviour change follows: an unsubscribed request leaves an enter with no
  exit, this schema's existing way of saying "started, never finished". The old
  code eventually emitted an exit for a request the caller had abandoned.

### Added

- **`@rixmerz/flowtrace-browser` is published on npm**, with TypeScript
  declarations. Until now the browser layer was `private` and reachable only by
  copying its source into the application — so the fix above could not have
  reached anyone.

  It is the one capture layer published on its own, and the split is
  structural rather than a change of heart: every other layer is vendored
  inside `@rixmerz/flowtrace` because the CLI launches the runtime and injects
  the layer into it, whereas a browser layer is a build-time dependency of the
  application's own bundle that no global CLI install can inject. Reaching it
  through the CLI tarball was measured and rejected — 31 MB of `@swc/core`, a
  2.3 MB Java jar and a package-manager build-script prompt, to import 60 KB.

- **`traceHttpSpan(req)`** on the framework-agnostic entry point: the same span
  as `traceHttp` but as a handle, for a caller that must hand back something
  other than a Promise. That constraint is not Angular's — a React binding
  wrapping fetch with an `AbortController` hits it identically.

- **The TypeScript declarations duplicate Angular's shapes structurally**
  rather than depending on `@angular/common/http`, so the package stays out of
  the framework's dependency graph while `flowtraceInterceptor` remains
  assignable to `HttpInterceptorFn`. Verified by building a real Angular 22 /
  TypeScript 6 application against the packed tarball.

### Documentation

- **The CORS preflight requirement**, which was documented nowhere.
  `traceparent` is not a CORS-safelisted request header, so the interceptor
  turns a simple cross-origin request into a preflighted one. An API sending
  `Access-Control-Allow-Headers: Content-Type` fails the preflight and the
  request never happens — turning on FlowTrace looks like it broke the app.
  Recorded in `BROWSER_NOTE`, so `flowtrace://runtimes` carries it.

## [3.3.0]

### Security

- **A traced Go HTTP handler no longer writes the request's headers into the
  trace.** Instrumenting `func(w http.ResponseWriter, r *http.Request)`
  serialized both parameters, and a `*http.Request` renders its whole header
  map — so tracing any authenticated service put `Authorization` and `Cookie`
  values into a file on disk. These files are meant to be read by an AI tool
  and pasted into a conversation, which makes them the last place a credential
  should be.

  Handlers now record `http.method` and `http.path` instead. That is more
  useful as well as safer: it identifies which request a span belongs to, where
  the serialized `ResponseWriter` was only noise. `r.URL.Path` is deliberate —
  `RequestURI` and `URL.String()` carry the query string, and tokens end up in
  query strings more often than anyone would like. Only the exact handler shape
  is affected; a function with the same parameter types but a result keeps
  ordinary argument capture.

### Fixed

- **"Durations include child spans. Always." was wrong for async code**, and
  the skill said it twice. It holds for an awaited chain — a parent awaiting a
  200 ms child reports ~202 ms, measured. It does not hold when a span starts
  async work without awaiting it, which is what an express middleware calling
  `next()` does: the parent closes in ~2 ms while the child runs 300 ms, so
  subtracting children yields a **negative** self-time. The guidance to
  "subtract children before calling something slow" therefore produced a
  nonsense number precisely where someone would be reasoning about latency.
  Documented as the signal it is — the parent handed the work off — along with
  the warning not to sum overlapping async spans into a total.

## [3.2.0]

### Added

- **Inbound `traceparent` is adopted automatically in Node/TS and Go.** All
  three runtimes already had an API for it — `runWithRemoteContext`,
  `remote_context`, `SeedFromTraceparent` — and in none of them was that API
  reachable. `@flowtrace/capture-node` is not published, and under
  `flowtrace run` the Node runtime lives inside the CLI tarball at a
  version-pinned vendor path. Worse in Go: `flowtracert` is injected as
  `<module>/internal/flowtracert` and exists only during an instrumented build,
  so a handler calling it compiles under `flowtrace run` and **breaks the
  user's ordinary `go build`**. "Call this in your handler" was advice nobody
  could act on.

  Node is now patched at `http.Server.prototype.emit` — the single choke point
  every framework arrives through, since `createServer(fn)` is itself
  `on('request', fn)`, so express, fastify, koa, plain `http` and `https` are
  all covered by one patch with no per-framework knowledge. Go is seeded by the
  transformer, which recognises `func(http.ResponseWriter, *http.Request)` by
  resolving the real `net/http` import rather than matching the text
  `http.ResponseWriter` — a false positive would inject `r.Header.Get` into
  something that is not a request, and a tracer must never break the build it
  was pointed at.

  Verified on a browser -> Node -> Java -> Go chain: all three service traces
  carry the browser's `trace_id`. Before this, that chain produced three
  unrelated trees.

  **Python is the remaining gap** and is now documented as such instead of
  being listed alongside the others. It has no equivalent single choke point —
  WSGI, ASGI and `http.server` are three unrelated entry shapes — so its header
  path is still a manual `remote_context` call.

### Fixed

- **That matrix was itself wrong on first writing**, and is corrected here.
  It claimed Node and Python adopt an inbound HTTP `traceparent`
  automatically. Only the `FLOWTRACE_TRACEPARENT` env carrier was automatic;
  the header path was a manual call in both. The claim was found by running a
  real four-stack chain, not by any test — `make test` validates no
  documentation content, and the plugin check asserted only that the word
  "traceparent" appeared in the resource, not that what it said was true.
  Node's half is now genuinely automatic (see above); Python's is documented
  as manual.

- **`plugin/bin/flowtrace` used `npx`, which dies in the projects it exists to
  trace.** npm resolves configuration from the nearest `package.json` to the
  *current* directory, and `flowtrace run` is by definition run from inside the
  user's project — so a project declaring `devEngines.packageManager` as pnpm
  or yarn made npm refuse outright with `EBADDEVENGINES`. The shim now installs
  into a cache directory that owns its own `package.json`, keeping the user's
  project out of npm's config resolution, and execs the CLI from their cwd.

## [3.1.1]

### Fixed

- `flowtrace run` refuses to trace Node below 20.6 instead of emitting an empty
  trace — see the entry under 3.1.0 for why that failure mode deserves an
  up-front refusal. 3.1.0 shipped without it.

## [3.1.0]

### Added

- **Go capture layer** (`capture/go/`). Go returns as a real v2 capture layer,
  held to the same contract as the other three: schema-v2 JSONL, W3C trace
  context, and nothing for the user to edit. `flowtrace run --lang go -- go
  run ./cmd/api`; `go build` and `go test` work the same way.

  Go has no runtime hook to attach to — no import hook, no module loader, no
  bytecode agent — so instrumentation happens before the compiler runs.
  Packages are enumerated with `go list -json`, each matching file is
  rewritten, and the result reaches the compiler through `go build -overlay`.
  **The user's tree is never written to**, not one byte: the runtime is
  injected as `<their-module>/internal/flowtracert`, a package the compiler
  sees but the disk never holds, which is also why it needs no `require`, no
  `replace`, no `go.sum` entry and no network fetch. Both the transformer and
  the injected runtime are stdlib-only, so tracing can never conflict with the
  target's dependency graph.

  Rewriting is byte-splicing at AST offsets rather than printing a mutated
  AST, because printing shifts line numbers — a panic in instrumented code
  reports the original file at the original line, verbatim.

  A goroutine's spans nest under whatever spawned them, across a plain `go`
  statement, with no change to the traced code. This uses the pprof label slot
  (`g.labels`), which the Go runtime itself copies parent-to-child — the only
  mechanism that propagates without rewriting `go` statements, which would
  change when their arguments are evaluated.

  Field mapping is Go's own: a method's receiver type becomes `class` (empty
  for a package-level function), the package import path becomes `module`,
  exported/unexported becomes `public`/`private`, and `thread` is
  `goroutine-<id>`. A returned non-nil `error` populates the `error` field
  alongside `panic` — returning an error is ordinary control flow in Go, but
  it is also what a Go developer is debugging, and it is what makes
  `trace_find_error` useful there.

  **Requires Go 1.24 or newer.** The label slot only has the layout this
  depends on from 1.24; on 1.21–1.23 it is a `map[string]string`, and writing
  to it there crashes the profiler. Both the toolchain and the target module's
  own `go` directive are checked before any file is touched, and refused with
  an actionable message rather than a crash.

  Known limits, stated rather than discovered later: closures (`FuncLit`) get
  no span of their own, dependencies and the standard library are out of
  scope, goroutine pools defeat span inheritance because workers predate the
  span, and injecting a `defer` makes an instrumented function permanently
  non-inlinable.

- **Go joins a trace another process started.** Go was the one capture layer
  that could not take part in a distributed trace: Java, Node and Python all
  adopt an inbound W3C `traceparent`, while Go minted a fresh `trace_id` on
  every root span, so a Node → Go → Java chain produced three unrelated trees.
  You could show each hop was clean and still not show the chain was joined.

  Inbound is automatic from `FLOWTRACE_TRACEPARENT`, the same carrier and the
  same variable Java, Node and Python already read, so a parent seeds any
  child the same way regardless of language. For a server receiving the header
  on the wire, `flowtracert.SeedFromTraceparent(r.Header.Get("traceparent"))`
  at the top of the handler does the same thing and returns a restore func.

  Outbound is exposed as `flowtracert.CurrentTraceparent()` and left to the
  caller — deliberately, not as an oversight. Node attaches it automatically
  because `globalThis.fetch` and `http.request` are mutable bindings it can
  patch at runtime; Go resolves `net/http` at compile time, so the equivalent
  means rewriting standard-library call sites inside the `-overlay` pass, to
  inject a header the caller may already be setting. The propagation matrix in
  `docs/architecture.md` states per runtime which direction is automatic.

- **`FLOWTRACE_MAX_EVENTS`** — a per-process event cap for the Go layer
  (default 100,000; `0` disables). It only stops *new* spans from opening: a
  span whose `enter` was written always gets its `exit`, so an `enter` with no
  `exit` keeps meaning "this call never returned" and never "the cap dropped
  it". The file can therefore exceed the cap by up to the number of spans open
  when it is reached.

### Changed

- **Schema v2's `lang` enum accepts `"go"`.** Additive — every document valid
  before stays valid, so the schema is still v2.
- The plugin (2.3.0) learns Go: `/flowtrace:trace` detects a `go.mod` and takes
  the prefix from its `module` line, and the plugin and marketplace
  descriptions name Go alongside the other four.
- **The plugin ships `flowtrace` on your PATH.** Claude Code puts
  `<plugin-root>/bin` on PATH and `/flowtrace:trace` told agents to run
  `flowtrace run`, but the plugin shipped no `bin/` — `which flowtrace` came
  back empty, and tooling fell back to whatever checkout happened to be on
  disk. `plugin/bin/flowtrace` shells to a pinned
  `npx @rixmerz/flowtrace@<version>`; it cannot be the real CLI, because a
  plugin install copies a directory and runs no build while the CLI needs
  platform-specific native builds of `@swc/core`.
- **New MCP resource `flowtrace://runtimes`.** Which runtimes are supported,
  their minimum versions, how each is invoked, where the package prefix comes
  from, what cross-process propagation each has, and which npm package is
  real. It exists because that question had four contradictory answers in this
  repo at once, and an agent asked to trace a Go service picked whichever file
  it read first. `mcp-server/src/runtimes.ts` is now the source; the prose is a
  restatement.
- `scripts/check-plugin.mjs` additionally enforces that `plugin/bin/*` is
  tracked executable (mode 100755 — a shim committed 644 is not executable
  after a clone), that the shim's version pin matches
  `flowtrace-cli/package.json`, and that the booted bundle really serves
  `flowtrace://runtimes`.

### Fixed

- **`npm install -g @flowtrace/cli` was the first command in both READMEs, and
  that package has never existed on npm.** The published CLI is
  `@rixmerz/flowtrace`. Every user's first step 404'd — and with no resolvable
  `flowtrace` binary, tooling falls back to hand-wiring a capture layer or
  symlinking `@flowtrace/capture-node` out of a local checkout, which
  reproduces on exactly one machine and never in CI.
- **`@flowtrace/capture-node`, `@flowtrace/mcp-server` and
  `flowtrace-dashboard` are not installable and now say so.** All three are
  workspace-internal — vendored into the CLI tarball by
  `flowtrace-cli/scripts/vendor.mjs` or bundled into the plugin — but nothing
  marked them `private`, so they read as npm packages. `@rixmerz/flowtrace` is
  the only published package, and it carries every capture layer.
- **`README.en.md` did not mention Go at all** while `README.md` did, and
  `CLAUDE.md` stated Go had been removed. Reconciled.
- **The advertised Node floor was 18+; the capture layer has needed 20.6+ for
  some while.** The ESM loader registers with `module.register()`, which landed
  in 20.6 — `capture/node/package.json` has said `>=20.6` all along while both
  READMEs said 18+. Corrected to 20.6+, and `flowtrace run` now refuses on an
  older Node with the version and the reason instead of proceeding. This is the
  failure that most deserves an up-front refusal: the loader silently never
  registers and the trace comes out **empty**, which reads as "my code never
  ran" rather than as a version problem. The CLI's own `engines` floor stays at
  18 on purpose — tracing Java, Python and Go there is unaffected.
- **Both READMEs said traces land in `./flowtrace.jsonl`.** `flowtrace run`
  writes `.flowtrace/<timestamp>.jsonl` and prints the path on startup;
  `flowtrace.jsonl` is only the default when a capture layer is wired by hand.
- **Cross-process propagation was documented nowhere**, despite being real and
  covered end to end by `capture/node/test/test-cross-process.mjs` — so it kept
  being reported as a missing feature. `docs/architecture.md`, both READMEs,
  the skill and `/flowtrace:trace` now carry the per-runtime matrix.
- **`docs/architecture.md` described capture mechanisms the code stopped using.**
  It had Python on a `sys.setprofile` global hook and Node on a `Module._load`
  monkey-patch with `--experimental-loader`; both have been AST rewriting at
  load time for some while — Python through a `sys.meta_path` finder, Node
  through a loader registered with `module.register()`. Corrected alongside
  the new Go row, since a stale architecture doc is how the next reader
  inherits a wrong mental model.

## [3.0.3]

### Fixed

- **A Java virtual thread's span landed orphaned, in its own trace.**
  OpenTelemetry's `Context` propagation relies on a plain `ThreadLocal`,
  which neither platform nor virtual threads inherit across `Thread.start()`
  — found dogfooding the Java capture layer against a JDK 21 program using
  `Thread.ofVirtual()`. A virtual thread's call now correctly nests under
  its caller's span (same `trace_id`, correct `parent_id`) instead of
  starting a disconnected trace with `parent_id: null`. Fixed by snapshotting
  `Context.current()` at `Thread.start()` and restoring it for the duration
  of the virtual thread's `run()`. Scoped to virtual threads only — platform
  `Thread`s load before the javaagent's `premain` runs and are never
  retransformed by this mechanism, so their context is not propagated by
  this fix; a matcher that claimed otherwise, and did nothing, was removed
  along with the false doc claim.
- **That same fix, once added, leaked memory on a failed `Thread.start()`.**
  A virtual thread that never reaches `run()` — restarting an
  already-terminated one (`IllegalThreadStateException`), or a scheduler
  rejection (`RejectedExecutionException`) — left its snapshotted `Context`
  pinned in memory forever. `start()`'s advice now cleans up its pending
  entry on any exception out of `start()`, not just on the success path.

## [3.0.2]

### Fixed

- **The dashboard no longer labels every module-level function "Unknown".**
  `PerformanceAnalyzer._buildMethodStats` grouped calls by `class.method` and
  discarded `module` entirely, so `findSlowMethods`/`findBottlenecks`/
  `findErrorHotspots` never carried a module name for functions that aren't
  inside a class (the normal shape for Python/Node top-level functions).
  `table-renderer.js`'s `formatClassName` then rendered the resulting empty
  class as the literal string `"Unknown"`. The analyzer now keys by
  `module|class|method` (matching the convention `trace_diff`/
  `trace_private_calls` already use) and carries `module` on every row; the
  table renderer falls back to it when there is no class, and only reports
  `"Unknown"` when neither is present.

The **trace schema** is versioned separately from the tooling: it is `v2`, it
did not change in this release, and `schema/flowtrace-v2.json` remains the
contract every capture layer locks to. A trace produced by 2.0.0 is read
identically by 2.1.0.

## [3.0.1]

### Fixed

- **Instrumenting an async generator with a `return` no longer crashes at
  import.** The AST rewriter used to turn every `return` — bare or not —
  into a value-capturing form, but CPython only allows a bare `return`
  inside an `async def` containing `yield`; the rewritten form was always
  illegal there. A related pre-existing bug in `_has_yield()` (nested
  functions' yields leaking into the outer function's generator
  classification, via `ast.walk()` not honoring a `continue` the way the
  code assumed) is fixed alongside it — it fed the same misclassification
  into both the old wrapping-branch selection and this new guard.

## [3.0.0]

### Fixed

- **`_ft_exit` no longer crashes the traced process.** A function returning a
  `dict` with non-JSON-serializable values now has its `result` passed
  through `_to_json_safe` like every other return type, instead of being
  handed to the emitter raw.
- **A stale `__pycache__` no longer silently disables Python instrumentation.**
  `FlowtraceSourceLoader` now overrides `get_code()` so every import goes
  through `source_to_code()` (and FlowTrace's own content-hashed cache),
  instead of `SourceFileLoader` returning a pre-existing, un-instrumented
  `.pyc` from disk.
- **`flowtrace init`/`run` detect the Python import name, not just the PyPI
  distribution name.** `detectPythonPrefix()` now also checks
  `[tool.hatch.build.targets.wheel].packages`,
  `[tool.setuptools.packages.find]`, a single package under `src/`, and a
  single top-level package next to `pyproject.toml`, before falling back to
  the distribution-name guess. `flowtrace run` also warns on stderr with the
  final event count when a Python run completes with zero events.
- **`log_close` sessions are now distinguishable from unknown ones.** A
  session id closed via `log_close` reports a descriptive "was closed"
  message on reuse instead of the generic "Invalid sessionId".
- **`flowtrace init` detects the Python import name too, not just `run`.**
  `init` and `run` used to call two separately-implemented prefix-detection
  functions; `init`'s copy never received the distribution-name-vs-import-name
  fix above, so `flowtrace init` alone still printed the wrong prefix for
  exactly the case that motivated the original fix. Both commands now share
  one implementation (`lib/python-prefix.js`).
- **The dashboard no longer shows `NaN`/`NaN%` for every duration metric.**
  `PerformanceAnalyzer` had been rewritten to return raw-nanosecond,
  `_ns`-suffixed fields (`avg_ns`, `total_ns`, `p95_ns`, `p99_ns`,
  `totalErrors`) that none of its three real consumers
  (`metrics-panel.js`, `table-renderer.js`, `cli.js`) were ever updated to
  read. The analyzer now converts to milliseconds at its own boundary and
  emits the ms-based, consumer-matching contract those three already
  expected (`avgDuration`, `totalTime`, `totalExceptions`, `errorRate`,
  `p95`, `p99`, `callCount`, `exceptions`), with no dual emission of the old
  `_ns` names.
- **The Time Distribution chart no longer renders empty.**
  `calculateTimeDistribution()` returned a per-method breakdown
  (`{total_ns, distribution: [...]}`) while `chart-renderer.js` expected a
  duration-range histogram (`{ranges: [{range, count, percentage}]}`),
  so `.map()` on the missing `ranges` threw and the chart never drew. It now
  buckets every call across the whole trace into `<1ms`, `1-10ms`,
  `10-100ms`, `100ms-1s`, `1-10s`, `>10s` ranges, only emitting buckets that
  have at least one call.

### Changed

- **`flowtrace analyze` no longer opens a second browser tab when a
  dashboard is already running.** The reuse path still POSTs the trace and
  prints the resulting URL (`Dashboard already running — view this trace
  at: <url>`), but only a genuinely fresh server spawn now opens a browser
  tab automatically.
- **`flowtrace analyze` opens the trace already loaded**, instead of a bare
  dashboard tab the user then has to manually upload the JSONL into. It POSTs
  the file to the dashboard's `/api/analyze-file` (the same call
  `flowtrace-dashboard/mcp-tools.js` already made for MCP-agent callers) and
  opens `?analysis=<id>`; a failed pre-load falls back to the bare URL with a
  stderr warning rather than blocking the dashboard from opening at all.

- **BREAKING (behavior): argument redaction.** `_serialize_args` now redacts
  argument values whose name matches a redact-key list (case-insensitive
  substring match) before truncation, checked recursively so a matching key
  nested inside a dict argument is also caught, not just top-level ones. This
  applies by default even when `FLOWTRACE_REDACT_KEYS` is unset, using a
  built-in list: `password,secret,token,authorization,api_key,url,dsn,
  connection_string,email`. `FLOWTRACE_REDACT_KEYS`, when set, is
  comma-separated substrings ADDED to that built-in list, not a replacement
  for it. Any traced argument (or nested dict key) whose name contains one of
  those substrings is now emitted as `"<redacted>"` instead of its real
  value.
- **MCP `trace_tree` caps output.** Accepts optional `maxDepth` and
  `maxNodes` (default 2000 total nodes); an elided subtree carries
  `truncated: true` plus a count of elided descendants, and the top-level
  result reports `truncated`/`totalNodes`.
- **MCP `trace_diff` groups by `module + class + method`**, matching the key
  `trace_private_calls` already uses, instead of by method name alone —
  identically-named methods in different classes/modules no longer get
  averaged together. Rows also carry `module`/`class` fields, and are
  filterable/sortable by a `min_abs_delta_ns` floor so a tiny sub-microsecond
  percentage swing no longer outranks a large absolute regression.

## [2.1.0]

### Added

- **Browser capture** (`capture/browser/`). HTTP requests, route changes and
  unhandled errors, emitted as ordinary schema v2 events. It deliberately does
  not instrument every function: the browser has no `AsyncLocalStorage`, so
  there is no ambient async context to attribute an arbitrary call to the
  request that caused it. Angular bindings included; all the logic lives in
  `api.js` and is tested without Angular.
- **Trace collector** — `POST /api/trace` on the dashboard. Validates every
  event against the schema before writing, takes its destination from
  server-side config only, and restricts CORS to localhost.
- **Trace context across a process spawn.** `FLOWTRACE_TRACEPARENT` carries a
  W3C traceparent through the environment; Node injects it into every child it
  spawns, and Node, Python and Java each read it at startup. A test runner or
  CLI pipeline that shells out no longer splits into unrelated traces.
- **Automatic outgoing propagation** in Node. The bootstrap patches `fetch` and
  `http`/`https` so a request made by a dependency still joins the trace. A
  caller-set header always wins; nothing is attached outside a span.
- **Field-level filtering in `log.search` and `log.aggregate`** via `where`
  (method, class, module, visibility, ids, `has_error`, duration and depth
  ranges), plus `offset` paging.
- **`log.close`** and an LRU session cap (`FLOWTRACE_MCP_MAX_SESSIONS`,
  default 8).
- Java CI matrix over JDK 17, 21 and 25.

### Fixed

- **Java traces were invalid JSON under any comma-decimal locale.**
  `String.format("%.3f")` without a locale renders `"ts":1785481163,844` in
  Chile, Spain, Germany, France or Brazil, making every line unparseable. CI
  runs under an English locale, which is why nothing saw it.
- **`visibility: "protected"`** is not in the schema's enum, so every protected
  Java method produced an invalid event. It now maps to `internal`.
- **The error contract diverged across all three layers.** Java and Node omitted
  the required `result` on the throw path, producing schema-invalid events;
  Python put the error inside `result` where no consumer looked, so
  `trace.find_error` returned null on traces full of exceptions. All three now
  emit a top-level `error` with `result: {}`.
- **FlowTrace instrumented its own runtime** when run from source, killing the
  traced program silently — exit 0, no output, no events.
- **Outgoing propagation missed `import { request } from 'node:http'`.** A
  builtin's ESM facade snapshots its named exports when created, so a static
  import inside the runtime bound the unpatched function for applications using
  the named-import style.
- **FlowTrace could not instrument Java 25 at all.** The pinned OTel agent
  bundled a ByteBuddy that stops at class file version 24, so every class was
  skipped and the JVM exited cleanly having traced nothing.
- The MCP server handled an `event: "error"` variant the schema forbids; those
  branches were unreachable and their one test used a hand-crafted event no
  agent can emit.

### Changed

- **MCP tools renamed from dotted to underscored names** — `log.open` becomes
  `log_open`, `trace.tree` becomes `trace_tree`, and so on for all nine. Tool
  names are expected to match `^[a-zA-Z0-9_-]+$`, and strict clients reject a
  dot at registration, so the server exposed tools some clients simply could not
  see. Everything that referenced them — the skill, the subagent, the commands,
  the tests and the docs — moved in the same commit, and the plugin ships the
  server, so there is no separately versioned client to strand.
- **`log.search` returns `{total, offset, returned, truncated, rows}`** instead
  of a bare array. The previous shape silently sliced to 200 rows, so a caller
  could not tell 12 matches from 12,000. This is a breaking change for direct
  consumers of the tool; the MCP server ships inside the plugin as one unit, so
  there is no separately versioned client.
- The plugin now runs a committed, self-contained bundle
  (`plugin/mcp/server.bundle.js`). Previously `.mcp.json` pointed at a
  gitignored path outside `CLAUDE_PLUGIN_ROOT` that needed `node_modules`, so
  an installed plugin exposed no tools at all.
- Java compiles with `<release>` instead of `source`/`target`, which makes the
  Java 11 floor enforced rather than merely stated. The target stays at 11
  deliberately: for an agent it is the floor of what can be instrumented, not
  the JDK we build on.

### Removed

- **v1, entirely** — the standalone Java premain agent, the separate JS agent,
  the Go, Rust and .NET implementations, the v1 Python agent, the root install
  scripts and the v1 documentation. 288 files, roughly 52k lines. None of it
  emitted `trace_id` or `span_id`, so nothing in the v2 pipeline could read a
  single line of its output.

## [2.0.0]

Initial v2 release: unified JSONL schema with W3C trace context, capture layers
for Java, Node/TypeScript and Python, CLI, dashboard and MCP server.
