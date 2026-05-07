# Sprint 2 — Java Capture Design (OTel Java Agent Extension)

Status: design + spike. No implementation. Targets `examples/golden/java/expected.jsonl`
(Calculator.run -> add -> _validate x2, with `_validate` private).

Hard constraint reaffirmed: zero source modification of the user app — no annotations,
no imports. The CLI injects `-javaagent:flowtrace-otel.jar`
`-Dotel.javaagent.extensions=<same-jar>` and a package-prefix system property.

---

## 1. Spike — Can OTel Java Agent extensions instrument PRIVATE methods?

### Answer: YES.

Evidence and mechanism:

- The OpenTelemetry Java agent loads extensions through the
  `io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule`
  + `TypeInstrumentation` SPI (registered via `@AutoService`).
- Under the hood, the agent uses **Byte Buddy's `AgentBuilder`** and exposes
  Byte Buddy's full `ElementMatchers` to the extension. There is no agent-level
  filter that drops private methods; the "skip private" behavior in shipped
  instrumentations is a per-instrumentation choice (framework boundary
  matchers), not an SPI restriction.
- Confirmed in `opentelemetry-java-instrumentation` source: extensions can
  match `isMethod().and(not(isStatic())...)` without `isPublic()`. Private
  matchers like `isPrivate()` are valid and are honored at class-load time
  because Byte Buddy rewrites bytecode before the JVM verifier sees the class.
- The extension uses the **Muzzle-bypassing `helper-injector`** path
  (`InstrumentationModule#isHelperClass`) to ship our `FileWriter` and
  exporter into the bootstrap/agent classloader so user code stays isolated.

Minimal matcher snippet (illustrative, for the implementer):

```java
public class FlowtraceMethodInstrumentation implements TypeInstrumentation {
    private final String prefix; // from -Dflowtrace.package-prefix

    @Override
    public ElementMatcher<TypeDescription> typeMatcher() {
        return nameStartsWith(prefix)
                .and(not(isInterface()))
                .and(not(isSynthetic()));
    }

    @Override
    public void transform(TypeTransformer t) {
        t.applyAdviceToMethod(
            isMethod()
                // NOTE: deliberately NO isPublic() — capture private/protected/package too
                .and(not(isAbstract()))
                .and(not(isSynthetic()))
                .and(not(isTypeInitializer()))
                .and(not(isConstructor())), // optional; include if golden requires
            FlowtraceAdvice.class.getName());
    }
}
```

`FlowtraceAdvice` uses `@Advice.OnMethodEnter` / `@Advice.OnMethodExit` with
`@Advice.AllArguments Object[] args`, `@Advice.Return(typing = DYNAMIC) Object ret`,
`@Advice.Thrown Throwable err`, `@Advice.Origin("#t") String declaringType`,
`@Advice.Origin("#m") String method`, `@Advice.Origin int modifiers` — modifiers
yield `Modifier.isPrivate(...)` etc. for the `visibility` field.

### Fallback (only if needed)

If a future OTel agent version restricts the SPI, the documented fallback in
`HANDOFF_V2.md:133` is a raw Byte Buddy `AgentBuilder` `premain` (drop OTel
correlation, keep depth + visibility). The design below stays compatible with
that fallback by isolating span-id generation behind a `SpanIdSource`
interface — swap OTel Tracer for a `ThreadLocal<Deque<String>>` of
random 16-hex tokens.

---

## 2. Architecture

### Module layout

```
capture/java/
  flowtrace-otel-extension/
    pom.xml                       (Maven, Java 11, shaded uber-jar)
    src/main/java/io/flowtrace/otel/
      FlowtraceExtension.java     implements AutoConfigurationCustomizerProvider
      FlowtraceSpanExporter.java  implements SpanExporter
      FlowtraceInstrumentationModule.java   extends InstrumentationModule
      FlowtraceMethodInstrumentation.java   implements TypeInstrumentation
      FlowtraceAdvice.java        @Advice.OnMethodEnter/Exit
      writer/JsonlWriter.java     thread-safe append-only writer
      writer/JsonEncoder.java     minimal allocation-light JSON encoder
    src/main/resources/META-INF/services/
      io.opentelemetry.javaagent.extension.AgentListener
      io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule
      io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider
```

Shaded uber-jar (`flowtrace-otel.jar`) bundles:
- our extension classes (relocated under `io.flowtrace.otel.shaded.*` if needed)
- `io.opentelemetry:opentelemetry-api` (compile-only against agent's; runtime resolved)
- ByteBuddy: provided by the OTel agent classloader bridge — do NOT bundle.

Maven coords: `io.flowtrace:flowtrace-otel-extension:2.0.0-SNAPSHOT`.

### Class responsibilities

- **FlowtraceExtension** — registers `FlowtraceSpanExporter` via
  `addTracerProviderCustomizer((b, cfg) -> b.addSpanProcessor(SimpleSpanProcessor.create(exporter)))`.
  Reads `flowtrace.package-prefix`, `FLOWTRACE_OUTPUT`, `flowtrace.max-arg-length`.
- **FlowtraceInstrumentationModule** — SPI entry; declares helper classes,
  delegates to `FlowtraceMethodInstrumentation`.
- **FlowtraceMethodInstrumentation** — matchers (see snippet above).
- **FlowtraceAdvice** — entry: open span via `GlobalOpenTelemetry.getTracer("flowtrace")`,
  attach attributes (class, method, visibility, args-json, thread, module),
  call `JsonlWriter.writeEnter(...)` synchronously. Exit: close span,
  populate result/error, call `JsonlWriter.writeExit(...)`.
- **JsonlWriter** — single `BufferedWriter` over `OpenOption.APPEND`; writes
  serialized via `synchronized` (path of least surprise; the bench target
  tolerates < 15% overhead). Optional v2: per-thread ring buffer + drainer
  thread if benchmark demands.

### Span -> JSONL v2 mapping

| Schema field    | Source                                                              |
|-----------------|---------------------------------------------------------------------|
| `event`         | `"enter"` on advice entry, `"exit"` on advice exit                  |
| `ts`            | `System.currentTimeMillis() / 1000.0` (or `nanoTime` baseline -> seconds float). Use `Instant.now().toEpochMilli() / 1e3` for portability |
| `trace_id`      | `Span.current().getSpanContext().getTraceId()` (32 hex)             |
| `span_id`       | `Span.current().getSpanContext().getSpanId()` (16 hex)              |
| `parent_id`     | parent of current via `Span.fromContext(parentCtx).getSpanContext().getSpanId()`, or `null` if invalid (root) |
| `thread`        | `Thread.currentThread().getName()`                                  |
| `lang`          | constant `"java"`                                                   |
| `module`        | package portion of FQN (from `@Advice.Origin("#t")`)                |
| `class`         | simple class name (FQN minus package)                               |
| `method`        | `@Advice.Origin("#m")`                                              |
| `visibility`    | `Modifier.isPrivate(mods) -> "private"` / `isProtected -> "internal"` / `isPublic -> "public"` / else `"internal"` (package-private maps to `internal` per schema enum) |
| `args`          | `{ "<paramName-or-arg0>": <jsonValue> }` from `@Advice.AllArguments`; truncate per `flowtrace.max-arg-length` |
| `depth`         | `ThreadLocal<int>` counter incremented on enter, decremented on exit |
| `result` (exit) | `{ "value": <jsonValue> }` or `{}` for `void`                       |
| `error` (exit)  | when `@Advice.Thrown` non-null: `{ type: ex.getClass().getName(), msg: ex.getMessage(), stack: stackToArray(ex) }` |
| `duration_ns`   | `System.nanoTime()` exit - enter (stored in advice via `@Advice.Local`) |

### Two events per span — design decision

OTel spans are intervals (one start, one end). Our schema requires two
JSONL lines (`enter`, `exit`). Decision: **emit on advice methods, not on span
lifecycle callbacks.**

- `@Advice.OnMethodEnter` — write `enter` line directly. Snapshot `trace_id`,
  `span_id`, `parent_id` from current OTel context (the OTel agent has already
  pushed the span by virtue of our advice opening it first; alternatively we
  open the span ourselves with `tracer.spanBuilder(...).startSpan()` and stash
  it in a `@Advice.Local("span") Span span`).
- `@Advice.OnMethodExit(onThrowable = Throwable.class)` — write `exit` line
  using the same `span` local + measured duration. Then `span.end()`.

This keeps line count = 2 per method invocation deterministically and avoids
relying on `SpanExporter` (which would receive only end-of-span batches and
lose true "enter ts").

`FlowtraceSpanExporter` is registered but used only as a no-op anchor for the
SDK customizer (and to disable default exporters cleanly). Default OTel
exporters are disabled via CLI flags below.

### Filtering

- System property `-Dflowtrace.package-prefix=<fqn-prefix>` (e.g.
  `io.flowtrace.example`) — required; when absent, the CLI
  auto-detects from `pom.xml`/`<groupId>` and injects.
- Matcher uses `nameStartsWith(prefix)`. Multiple prefixes: comma-separated,
  fold via `anyOf(...)`.
- Excludes: `not(isSynthetic())`, lambdas (`nameContains("$$Lambda$")`),
  generated proxies (`nameContains("$$EnhancerBy")`), and a hard deny-list
  (`java.*`, `javax.*`, `sun.*`, `jdk.*`, `io.flowtrace.otel.*`).

### Output path

- `FLOWTRACE_OUTPUT` env wins; else default `.flowtrace/<ISO-utc>.jsonl` in
  CWD; auto-`mkdir`. CLI also adds `.flowtrace/` to `.gitignore`.
- Append mode, UTF-8, line-buffered. `synchronized` write of one full
  serialized line per call (atomicity of `O_APPEND` writes < `PIPE_BUF`
  is OS-dependent; we don't rely on it — the lock is the contract).

### CLI injection (Java path)

`flowtrace-cli/lib/commands/run.js` — Java branch:

```bash
java \
  -javaagent:<resolved>/flowtrace-otel.jar \
  -Dotel.javaagent.extensions=<resolved>/flowtrace-otel.jar \
  -Dotel.traces.exporter=none \
  -Dotel.metrics.exporter=none \
  -Dotel.logs.exporter=none \
  -Dotel.javaagent.logging=none \
  -Dflowtrace.package-prefix=<detected> \
  -Dflowtrace.max-arg-length=512 \
  -jar app.jar
```

The CLI resolves `<resolved>` to `${flowtrace-cli}/vendor/java/flowtrace-otel.jar`
(packaged with the CLI release) or to a user-overridden path via
`FLOWTRACE_JAVA_AGENT`. Default OTel exporters are explicitly off because we
don't need OTLP to a collector — JSONL is our sink.

### Build

- Java 11 source/target. `maven-shade-plugin` for uber-jar with proper
  manifest:
  - `Premain-Class`: not set (we are an extension, not a primary agent)
  - `Implementation-Title`: `flowtrace-otel-extension`
- `mvn package` -> `capture/java/flowtrace-otel-extension/target/flowtrace-otel.jar`.
- `install-all.sh` copies the jar to `flowtrace-cli/vendor/java/`.

---

## 3. Risks + mitigations

| Risk                                                              | Mitigation                                                                                  |
|-------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| OTel agent classloader hides ByteBuddy from our advice            | Use the agent's exposed `net.bytebuddy` shaded namespace (the InstrumentationModule SPI gives us this for free)                              |
| Helper-class injection denied by Muzzle                           | Mark `JsonlWriter`/`JsonEncoder` via `InstrumentationModule#isHelperClass(String)`          |
| Recursive instrumentation of our own classes                      | Hard exclude `io.flowtrace.*` in `typeMatcher()`                                             |
| High overhead under hot loops                                     | `@Advice.Local` for nanoTime; lazy arg-serialization (only stringify if `args` length budget remaining); skip-on-OOM guard around writer    |
| Args containing huge graphs                                       | Honor `flowtrace.max-arg-length`; encoder truncates per `TRUNCATION_SYSTEM.md`              |
| `void` return types under advice                                  | `@Advice.Return(typing = DYNAMIC) Object ret` returns null; serialize as `{}` (schema satisfied) |
| Constructors / static initializers                                | Excluded for MVP. Document follow-up                                                        |
| `parent_id` for top-level method                                  | If `Span.current()` invalid -> emit `null` (schema accepts)                                 |
| Span IDs across worker threads                                    | OTel `Context` propagation handles `ExecutorService` IF user uses `Context.taskWrapping(...)`. We do NOT auto-instrument executors in MVP — document |
| Overhead > 15% on bench                                           | Switch `JsonlWriter` to per-thread buffer + async drainer; second pass                      |
| Spring Boot uses CGLIB proxies (private methods may not appear in subclass) | Documented limitation: Spring `@Component` private methods on proxied beans are still on the original class — our matcher catches them   |

---

## 4. Acceptance criteria for the backend implementer (verbatim, Wave B)

1. `cd capture/java/flowtrace-otel-extension && mvn -q -DskipTests package`
   produces `target/flowtrace-otel.jar` (single shaded jar, < 5 MB).
2. The jar's `META-INF/services/` includes
   `io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule`
   and
   `io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider`.
3. Running
   `java -javaagent:<otel-javaagent>.jar -Dotel.javaagent.extensions=<flowtrace-otel.jar>
   -Dotel.traces.exporter=none -Dotel.metrics.exporter=none -Dotel.logs.exporter=none
   -Dflowtrace.package-prefix=io.flowtrace.example -jar flowtrace-example/target/app.jar`
   produces `.flowtrace/<iso>.jsonl`.
4. The JSONL contains paired `enter`/`exit` events for `Calculator.run`,
   `Calculator.add`, and `Calculator._validate` (the last invoked twice).
5. `_validate` events have `"visibility": "private"`. `run` and `add` have
   `"visibility": "public"`.
6. Every event validates against `schema/flowtrace-v2.json` (use
   `ajv-cli` in a test step).
7. `trace_id` matches `^[0-9a-f]{32}$`; `span_id` matches `^[0-9a-f]{16}$`;
   `parent_id` is null at the root and a valid 16-hex elsewhere.
8. Each `exit` carries `duration_ns >= 0` and an `args` object identical (by
   value) to its paired `enter`.
9. `result` is `{}` for `void` methods and `{ "value": <jsonValue> }` otherwise.
10. Throwing methods produce an `exit` with a populated `error` object
    (`type`, `msg`, `stack[]`) AND `duration_ns >= 0`.
11. The user's source files are byte-identical before and after
    instrumentation (`sha256sum` check on `flowtrace-example/src/**/*.java`).
12. With `-Dflowtrace.package-prefix=` deliberately misset to a non-existent
    prefix, the JSONL is empty (no spurious framework traces).
13. `Dflowtrace.max-arg-length=64` truncates oversized args per
    `TRUNCATION_SYSTEM.md` parity rules.
14. Bench harness: 10k-iteration hot loop on a no-op method shows overhead
    < 15% vs. uninstrumented baseline (record both numbers in test output).
15. No writes to stdout or stderr from the extension during normal operation
    (MCP-server compatibility — stdout must remain pristine).
16. Re-running the same command appends a NEW dated JSONL, never overwrites.
17. On JVM shutdown (SIGTERM, `System.exit`), the writer flushes and closes
    cleanly (no truncated last line). Use a shutdown hook.

---

## 5. Recommended implementation sequence

1. **Day 1**: scaffold Maven module, shaded jar, empty `InstrumentationModule`
   that logs "loaded" to confirm SPI wiring against `flowtrace-example`.
2. **Day 2**: minimal advice that prints `class.method` + visibility for the
   golden trio. Validates the private-method matcher in situ.
3. **Day 3**: `JsonlWriter` + `JsonEncoder` + schema-conformant enter/exit
   lines (no OTel context yet — synthesize 32/16-hex via SecureRandom +
   `ThreadLocal<Deque>` for parent linkage).
4. **Day 4**: swap synthesized IDs for OTel `Span` + `SpanContext`. Confirm
   parent linkage matches manual ThreadLocal version.
5. **Day 5**: error path + truncation + shutdown hook + ajv schema validation
   harness.
6. **Day 6**: bench harness + `< 15%` gate. CLI integration in
   `flowtrace-cli/lib/commands/run.js`.
7. **Day 7**: docs update, golden parity test against
   `examples/golden/java/expected.jsonl`, hand-off.
