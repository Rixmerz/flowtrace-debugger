# FlowTrace Java capture layer

An **extension for the OpenTelemetry Java agent**, not a standalone
`-javaagent`. The OTel agent does the class loading, retransformation and
network-level trace propagation; this jar plugs into its extension SPI and
weaves ByteBuddy advice around every concrete method under a package prefix.
Each woven method emits one `enter` and one `exit` event to a JSONL file in
[schema v2](../../../schema/flowtrace-v2.json).

## How it is launched

The CLI (`flowtrace run`) assembles the command line; this is what it runs:

```bash
java -javaagent:opentelemetry-javaagent.jar \
     -Dotel.javaagent.extensions=flowtrace-otel-extension-<version>.jar \
     -Dotel.traces.exporter=none -Dotel.metrics.exporter=none -Dotel.logs.exporter=none \
     -Dflowtrace.package-prefix=com.example \
     -Dflowtrace.output=flowtrace.jsonl \
     -jar app.jar
```

The `otel.*.exporter=none` lines matter: FlowTrace writes JSONL directly from
the advice and never goes through the OTel SDK exporter pipeline, so without
them the agent tries to ship spans to a collector that is not there.

Build the jar with `make build-java` from the repository root, or
`mvn -q package` here. The shaded jar under `target/` has no runtime
dependencies: OTel API and ByteBuddy come from the agent, and Jackson is
test-only.

## Knobs

Every knob is a system property with an environment-variable fallback; the
property wins when both are set.

| Property | Env var | Default | Meaning |
|----------|---------|---------|---------|
| `flowtrace.package-prefix` | `FLOWTRACE_PACKAGE_PREFIX` | *(unset — nothing instrumented)* | Only classes whose name starts with this prefix are woven. Mandatory in practice: without it the module logs a warning and instruments nothing rather than flooding the trace with framework internals. |
| `flowtrace.output` | `FLOWTRACE_OUTPUT` | `.flowtrace/<UTC timestamp>.jsonl` | Output file, opened in append mode, always UTF-8. |
| `flowtrace.max-arg-length` | `FLOWTRACE_MAX_ARG_LENGTH` | `512` | Per-value limit on the JSON form of each argument and result. `0` disables truncation; an unparseable value falls back to the default. See [Truncation](#argsresult-encoding). |
| `flowtrace.redact-keys` | `FLOWTRACE_REDACT_KEYS` | *(built-in list only)* | Comma-separated **additional** redact-key substrings. Never replaces the built-in list. |
| `flowtrace.traceparent` | `FLOWTRACE_TRACEPARENT` | *(unset)* | W3C `traceparent` to continue a trace started by a parent process. |

`FLOWTRACE_PACKAGE_PREFIX` is read by the CLI, which turns it into the system
property; the extension itself reads `flowtrace.package-prefix` only.

## `args` / `result` encoding

Both events of a call carry the same `args` object: arguments are rendered
**once, at entry**, and reused for the exit event, so a method that mutates
its arguments still shows what it was called with.

Keys are the parameter names when the class was compiled with
`javac -parameters` (Spring Boot's parent POM turns that on), and `arg0`,
`arg1`, … otherwise. The JVM does not expose names from debug info alone.

`result` is `{"value": X}` for a non-void, non-null return, and `{}` for a void
method, a `null` return, or a call that threw (the exception is in `error`).

Each value goes through the same three rules every FlowTrace runtime applies
(see [`TRUNCATION_SYSTEM.md`](../../../TRUNCATION_SYSTEM.md)), in this order:

1. **Redaction.** A parameter name — or a `Map` key at any depth inside an
   argument or result — containing one of
   `password, secret, token, authorization, api_key, url, dsn, connection_string, email`
   (case-insensitive substring; plus anything in `flowtrace.redact-keys`)
   is replaced by the string `"<redacted>"`. The original value is never
   rendered, not even its `toString()`.
2. **Structural serialization.** `Map` (any key type, via `String.valueOf`),
   `Collection`, arrays including primitive arrays, numbers, booleans,
   strings, characters, enums and `Optional` become proper JSON, to a depth of
   3 containers and 100 entries per container (the rest collapse into a
   trailing `"...(+N)"` element). `NaN` and infinities become `null`.
   Anything else is its `toString()` as a JSON string. A value whose
   serialization throws — `toString()` failing, a `StackOverflowError`, a
   concurrent collection changing under iteration — becomes
   `"<unserializable: <fully qualified class name>>"` and costs only itself:
   the event is still emitted with every other argument intact, and nothing
   propagates into the traced method.
3. **Truncation.** If the rendered JSON of one value is longer than
   `flowtrace.max-arg-length` characters, the value is replaced by the string
   `<truncated:{first N characters of the JSON}...>`. The limit is measured
   on the JSON text — quotes and escapes included — which is what the Node,
   Python and Go layers measure, and `examples/golden/truncation/*` pins the
   three outputs against each other.

`ts` is epoch seconds with six fraction digits (microseconds), always with a
`.` decimal point regardless of the JVM's locale.

## Bytecode target 11, JDK matrix 17 / 21 / 25

The jar is compiled with `--release 11`. That number is the **floor of what
the agent can be loaded into**, not the JDK it is developed on: an extension
compiled for 21 cannot be attached to a Java 17 or 11 application, and the
older the application, the more it tends to need tracing. `--release` (rather
than `-source`/`-target`) links against the Java 11 API, so a call to an API
added later fails at compile time instead of as a `NoSuchMethodError` inside a
customer's JVM. Do not raise it.

The ceiling is decided by the OTel agent version in `pom.xml`: its bundled
ByteBuddy must recognise the class-file version of the JDK it runs on. CI runs
the suite on JDK 17, 21 and 25. Tests that need JDK 21 syntax (virtual
threads) live in `src/test/java21` and compile only under the
`jdk21-fixtures` profile, so the JDK 17 leg is unaffected.

## Thread and context caveats

Trace ids come from the OTel `Context`, so a child call is attributed to its
parent only where that context reaches it:

- **Same thread**: always.
- **Inbound HTTP** (`traceparent` header): handled by the OTel agent for the
  frameworks it instruments — no FlowTrace code involved.
- **Outbound HTTP**: the OTel agent injects `traceparent` for the clients it
  instruments; anything outside that set carries nothing.
- **`FLOWTRACE_TRACEPARENT` / `flowtrace.traceparent`**: adopted for the first
  root span of the process, so a parent process that spawned this JVM
  continues its trace. The carrier is validated strictly, like the other
  runtimes: lowercase hex, no surrounding whitespace, no trailing `-`.
  Anything else degrades to "start a new trace" — never to an error.
- **Virtual threads**: `Thread.ofVirtual().start(...)` propagates the
  starting thread's context (the extension weaves `VirtualThread.start/run`).
- **Platform threads and thread pools do NOT propagate.** A
  `new Thread(r).start()`, an `ExecutorService.submit(...)`, a
  `CompletableFuture.supplyAsync(...)` on the common pool: the code running
  there begins a **new trace with a null parent**, not a mis-attributed one.
  `java.lang.Thread` is loaded before any agent's `premain` runs, so ByteBuddy
  never gets to retransform it. The OTel agent's own executor instrumentation
  covers `Runnable`s it wraps at submit time, which helps only for the
  executor types it knows. Treat a trace that stops at a pool boundary as
  expected, and look for the continuation by wall-clock `ts` rather than by
  `trace_id`.

## Layout

| Path | Role |
|------|------|
| `extension/FlowtraceInstrumentationModule` | SPI entry: registers the type instrumentations and the helper classes that must be injected next to the application. |
| `extension/FlowtraceTypeInstrumentation` | Matches classes under the prefix and applies `FlowtraceAdvice` to their concrete methods. |
| `extension/ThreadContextInstrumentation` | Weaves `VirtualThread.start/run` for context propagation. |
| `advice/FlowtraceAdvice` | The woven enter/exit advice: span per call, depth, args, result, error. |
| `advice/TraceparentSeed` | Reads and validates the process-level `traceparent` carrier. |
| `advice/PendingThreadContext` | Weakly-keyed hand-off of a `Context` from `start()` to `run()`. |
| `emitter/ValueSerializer` | Redaction, structural JSON and truncation for every value. |
| `emitter/FlowtraceEmitter` | The JSONL writer: id validation, UTF-8, per-line flush, shutdown hook. |

Every class the advice touches at runtime is listed in
`FlowtraceInstrumentationModule.getAdditionalHelperClassNames()` — the advice is
inlined into the application's classes, so its helpers must be visible from
the application's classloader. Forgetting one shows up as an advice that
silently does nothing.

## Tests

```bash
mvn -q package                                 # build + unit tests
mvn -q test -Dflowtrace.it.required=true       # fail (not skip) if the agent jar is missing
```

`FlowtraceIntegrationTest` forks a JVM with the real agent and the freshly
built jar; run `package` first so the jar under `target/` is current. The
golden fixtures in `examples/golden/{java,truncation/java,error/java}` are
regenerated with `node scripts/gen-golden.mjs <id>` from the repository root.
