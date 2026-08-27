# Dogfood Java capture against a real JDK 21 run, fix what's found

flow: flowtrace-java21-dogfood

## Why

Session has exercised Python (3 real codebases) and Node (Astra's MCP
service) with the same methodology: run real/realistic code under FlowTrace,
not just unit tests, and fix whatever breaks. Java has never been dogfooded
this session — only its existing unit-test suite ran (as a side effect of the
dashboard's golden-fixture test), which is not the same thing: CI already
covers JDK 17/21/25 at the unit level (`.github/workflows/v2-ci.yml`), but
unit tests don't catch what live capture against unfamiliar, modern code
does (this session's Python bug was exactly that shape — invisible to any
existing test until a real app hit it).

Local environment: JDK 21.0.7 (JetBrains Runtime build, via sdkman) — used
directly, no separate JDK install needed. Go is explicitly out of scope: v2.0.0
removed the Go capture layer entirely (confirmed via `CHANGELOG.md` and
`capture/` containing only `java`, `node`, `python`, `browser`) — there is
nothing to validate.

## In scope

### AC1 — a modern Java 21 program traces cleanly under real capture
Build the OTel extension jar for this environment
(`cd capture/java/flowtrace-otel-extension && mvn -q package`), then run a
purpose-built demo program under `flowtrace run --lang java` that exercises
Java 21 features not present in the existing golden fixture
(`examples/golden/java/Calculator.java`, a plain class with no modern
syntax): a `record`, a `sealed interface` with pattern-matching `switch`, and
a virtual thread (`Thread.ofVirtual()`) calling into instrumented methods.
AC: the resulting `flowtrace.jsonl` has matched `enter`/`exit` pairs for
every instrumented method actually called, valid schema-v2 JSON on every
line, and the virtual-thread call path is attributed correctly (not dropped,
not attributed to the wrong parent span) — virtual threads are the one
JDK-21-specific runtime behavior most likely to break an OTel-agent-based
capture strategy, since they don't map 1:1 to OS threads the way the
instrumentation may assume.

### AC2 — any real bug found gets fixed with a regression test
Whatever AC1's run surfaces (a crash, a dropped span, a wrong
visibility/class mapping, a locale issue, anything the existing Java test
suite doesn't already cover) gets root-caused and fixed in
`capture/java/flowtrace-otel-extension/src/main`, with a new test in
`src/test` that fails before the fix and passes after — same discipline as
every other fix this session (Python's async-generator bug, the dashboard's
module-label bug). If AC1's run finds nothing wrong, this AC is satisfied
trivially — the deliverable is the confirmation itself, not a fix.

## Out of scope

- Go, Rust, .NET — removed in v2.0.0, not part of this repo.
- Re-running or restructuring the existing JDK 17/21/25 CI unit-test matrix —
  it already exists and already passes; this flow is about live-capture
  dogfooding, not duplicating CI.
- Any change to `examples/golden/java/` — that fixture is a stable regression
  anchor for the dashboard tests, not the vehicle for this investigation (a
  new demo program is used instead, so nothing there needs to change).
- JDK 25 specifically — already covered by CI's matrix; this flow tests the
  one JDK actually installed locally (21), which is also the version this
  session's environment defaults to.

## Approach

One demo Java 21 program under `capture/java/flowtrace-otel-extension`'s
existing test-fixture conventions (or a throwaway scratch dir if a
self-contained repro is simpler — not committed either way, same pattern as
the Python `pyverify`/`dashfix` scratch dirs used earlier this session).
`mvn package` to build the extension jar, `flowtrace run --lang java` (or the
java-agent flags directly if the CLI path adds no signal) to execute it, then
read the resulting JSONL for correctness. Any fix follows straight
Maven/JUnit conventions already used in `src/test`.

## Verification

- `cd capture/java/flowtrace-otel-extension && mvn -q test` (existing suite,
  regression coverage)
- Manual: trace the new Java 21 demo program, inspect `flowtrace.jsonl` for
  schema validity, correct enter/exit pairing, and correct virtual-thread
  span attribution
- If a fix lands: the new regression test, red before / green after
