# Sprint 6 Hardening Notes

> **Historical design document.** Kept for the reasoning behind the truncation and hardening work;
> it is not maintained against the code. The current behaviour lives in
> `docs/architecture.md`, `TRUNCATION_SYSTEM.md` and each layer's README.


## Emitter flush strategy — memory bounded by design

All three language emitters write and flush on every event. No in-memory
queue accumulates events between flushes.

| Lang   | Emitter path                                              | Flush strategy                          |
|--------|-----------------------------------------------------------|-----------------------------------------|
| Java   | `capture/java/.../advice/FlowtraceAdvice.java`            | `BufferedWriter` + `flush()` per line   |
| Python | `capture/python/flowtrace_runtime/emitter.py`             | `file.flush()` per `emit()` call        |
| Node   | `capture/node/src/runtime/emitter.js`                     | `fs.promises.appendFile` per event (O_APPEND syscall, no userspace buffer) |

Under a sustained 10k-call hot loop none of the emitters accumulate an
unbounded in-memory buffer. The only buffering that occurs is the OS
page-cache for the output file, which is bounded by the file size on disk.

## Truncation parity (Sprint 6)

All three agents now honour a max-arg-length knob:

| Lang   | Knob                              | Default | Format when exceeded              |
|--------|-----------------------------------|---------|-----------------------------------|
| Java   | `-Dflowtrace.max-arg-length=N`    | 512     | `<value>...[truncated]`           |
| Python | `FLOWTRACE_MAX_ARG_LENGTH=N`      | 512     | `<truncated:<first N chars>...>`  |
| Node   | `FLOWTRACE_MAX_ARG_LENGTH=N`      | 512     | `<truncated:<first N chars>...>`  |

Set `N=0` to disable truncation entirely on any agent.

Parity is verified by `benchmarks/truncation-parity.sh`, which runs each
agent with `max-arg-length=64` against a 1000-char string fixture and
asserts the truncation marker appears in the emitted JSONL.

## CI matrix (Sprint 6)

`.github/workflows/v2-ci.yml` expanded to:

- `validate-schema` — gate job (unchanged)
- `java-tests` — JDK 17, `make build-java test-java`
- `python-tests` — matrix: Python 3.9, 3.11, 3.13
- `node-tests` — matrix: Node 20, 22
- `cli-tests` — Node 20, CLI test suite
- `bench` — informational, uploads `benchmarks/results-*.json` as artifact

## Benchmark harness

`benchmarks/run-bench.sh` runs a 10k-iteration hot loop (baseline then
instrumented) for each language and prints a summary table. Overhead
gates are informational only:

| Lang   | Gate  |
|--------|-------|
| Java   | < 15% |
| Python | < 20% |
| Node   | < 15% |

Results are written to `benchmarks/results-<lang>-<timestamp>.json`.

## Source map e2e (Node)

`capture/node/test/test-sourcemap.mjs` verifies that `--enable-source-maps`
is accepted alongside the FlowTrace `--import` loader without fatal errors,
and that error events capture stack information referencing the original
source filename.
