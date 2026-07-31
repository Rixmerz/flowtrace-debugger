# FlowTrace v2 — measured overhead baseline

First real measurement of the v2 capture layers. Every number below came from
`bash benchmarks/run-bench.sh`; nothing here is estimated.

## Why per-event cost, and not a percentage

The advertised gates used to be "Java <15%, Python <20%, Node <15%". Those were
not merely unverified — they are **unexpressible** for this benchmark. An
uninstrumented 10 000-iteration loop of `add(x, y)` completes in well under a
millisecond, so a percentage is a division by approximately zero. Tracing a
function that performs one addition will always cost orders of magnitude more
than the function itself; that says nothing useful about a real workload.

So the metric is **microseconds of added wall-clock per emitted trace event**.
That figure transfers: multiply it by the number of traced calls in a request to
estimate the cost. A request that makes 200 traced calls in Node costs roughly
200 × 4 µs ≈ 0.8 ms; the same request in Python costs ≈ 4 ms.

Each iteration of the benchmark produces 4 events (`add` and `_validate`, each
entering and exiting), so 10 000 iterations plus warm-up yields ~42 000 events.

## Results

Recorded 2026-07-31 on an arm64 macOS host (Java 21, Python 3.14, Node 22).
Single run, no repetitions — treat these as an order of magnitude, not a
precision figure.

| Lang   | Baseline | Instrumented | Events | µs/event | Gate  |
|--------|----------|--------------|--------|----------|-------|
| node   | 0.97 ms  | 169.96 ms    | 42 002 | **4.0**  | <15 µs |
| java   | 0.31 ms  | 657.76 ms    | 42 004 | **15.7** | <40 µs |
| python | 0.93 ms  | 844.15 ms    | 42 004 | **20.1** | <40 µs |

Node is roughly 4× cheaper per event than Java and 5× cheaper than Python.

## Reading these honestly

- **This is the worst case by construction.** The traced function does a single
  addition, so tracing dominates completely and the emitter runs at maximum
  density. Real code does more work per call, so the *relative* cost is lower —
  but the absolute µs/event is what stays constant, which is why it is the number
  reported.
- **The emitter writes and flushes per event.** Java's `FlowtraceEmitter` calls
  `writer.flush()` on every line and Node's emitter appends per event. A batching
  emitter is the obvious lever if these numbers need to come down; that is a
  deliberate durability-vs-throughput trade, not an oversight.
- **The gates have 2–4× headroom** over the measured values, which is deliberate:
  CI runners are noisier than a local machine, and a gate that trips on scheduler
  jitter gets ignored, which is worse than no gate.
- Java's figure includes the OpenTelemetry javaagent's own startup and
  per-method span creation, since FlowTrace's advice starts a real OTel span per
  call. It is not purely FlowTrace's cost.

## Reproducing

```bash
make build-java build-python build-node   # all three toolchains must be present
make bench                                # or: bash benchmarks/run-bench.sh [lang...]
```

The harness **fails** (exit 1) if an instrumented run emits zero events, rather
than reporting it as zero overhead. That assertion is the point: the previous
harness silently substituted the baseline whenever instrumentation failed, so all
six committed result files read `overhead_pct: 0` while measuring nothing at all.

`results-<lang>-<timestamp>.json` files are run artifacts and are gitignored.
Update the table above deliberately when the numbers move, and say why.
