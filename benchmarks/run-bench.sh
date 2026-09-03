#!/usr/bin/env bash
# FlowTrace v2 benchmark harness — 10k hot-loop per lang × (baseline | instrumented).
# Usage: bash benchmarks/run-bench.sh
# Outputs: benchmarks/results-<lang>-<timestamp>.json  (one file per lang)
# Prints a summary table to stdout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BENCH_DIR="$REPO_ROOT/benchmarks"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)

# Overhead gates (informational only — non-blocking unless explicitly asserted).
#
# These predate the harness ever taking a real measurement, and all three are
# exceeded by orders of magnitude now that it does: the workload is 10k calls
# to a function that does one addition, with every call writing and flushing a
# JSONL line, so it is the worst case for a per-call tracer rather than
# anything resembling an application. Recalibrate them against a realistic
# workload before treating a WARN here as a regression.
JAVA_GATE=15
PYTHON_GATE=20
NODE_GATE=15

declare -A baseline_us
declare -A instrumented_us
declare -A overhead_pct

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

run_and_extract_us() {
  # Run command, capture stdout, extract BENCH_RESULT_US=<n>.
  #
  # Failure is LOUD. This used to swallow stderr, `|| true` the exit status and
  # return an empty string, which compute_overhead then turned into 0% — so a
  # harness that never ran at all reported "0% overhead", and six all-zero
  # result files were committed on the strength of it. A benchmark that cannot
  # tell "no overhead" from "no measurement" is worse than no benchmark.
  local output status
  output=$("$@" 2>&1) || status=$?
  local us
  us=$(echo "$output" | grep -oE 'BENCH_RESULT_US=[0-9]+' | cut -d= -f2 || true)
  if [ -z "$us" ]; then
    echo "[bench] FAILED: '$*' produced no BENCH_RESULT_US (exit ${status:-0})" >&2
    echo "$output" | tail -20 >&2
    return 1
  fi
  echo "$us"
}

require_built() {
  # A layer that is not built is a setup error, not a zero-overhead result.
  # Substituting the baseline for the instrumented run is how this harness
  # came to publish "0% overhead" for languages it never instrumented.
  local lang=$1 found=$2 how=$3
  if [ -z "$found" ]; then
    echo "[bench] $lang capture layer is not built — run \`$how\` first." >&2
    exit 1
  fi
}

write_result() {
  local lang=$1
  local file="$BENCH_DIR/results-${lang}-${TIMESTAMP}.json"
  cat > "$file" <<JSON
{
  "lang": "${lang}",
  "timestamp": "${TIMESTAMP}",
  "iterations": 10000,
  "baseline_us": ${baseline_us[$lang]},
  "instrumented_us": ${instrumented_us[$lang]},
  "overhead_pct": ${overhead_pct[$lang]}
}
JSON
  echo "  Wrote: $file" >&2
}

compute_overhead() {
  local base=$1
  local instr=$2
  if [ "$base" -eq 0 ]; then
    # A zero baseline means the measurement is meaningless, not that the
    # instrumentation is free. Say so rather than printing a reassuring 0.
    echo "[bench] baseline is 0 us — the measurement did not happen" >&2
    return 1
  fi
  echo $(( (instr - base) * 100 / base ))
}

# ---------------------------------------------------------------------------
# Java
# ---------------------------------------------------------------------------

bench_java() {
  echo "[java] compiling Bench.java..." >&2
  cd "$BENCH_DIR/java"
  javac Bench.java 2>/dev/null

  echo "[java] baseline..." >&2
  local base
  base=$(run_and_extract_us java Bench)
  baseline_us[java]="${base:-0}"

  echo "[java] instrumented..." >&2
  # Newest first, and no -SNAPSHOT in the pattern: the extension stopped being
  # a SNAPSHOT build at 2.2.0, so this glob silently stopped matching. That
  # hid the second bug underneath it — the run below was still the v1
  # invocation, `-javaagent:<extension>`, and this is an OpenTelemetry
  # javaagent *extension*, which the OTel agent loads. Run that way it fails
  # with "Failed to find Premain-Class"; the missing jar meant nobody saw it.
  local java_module="$REPO_ROOT/capture/java/flowtrace-otel-extension"
  local jar otel
  jar=$(ls -t "$java_module/target/flowtrace-otel-extension-"*".jar" 2>/dev/null | grep -v original | head -1 || true)
  otel="$java_module/target/dependency/opentelemetry-javaagent.jar"
  require_built "java" "$jar" "make build-java"
  # Maven puts the agent here during build-java, which is where the golden
  # runners find it too.
  [ -f "$otel" ] || otel=""
  require_built "java" "$otel" "make build-java"

  local instr outfile
  outfile=$(mktemp /tmp/ft-bench-java-XXXXXX.jsonl)
  instr=$(OTEL_TRACES_EXPORTER=none OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none \
    run_and_extract_us java \
      -javaagent:"$otel" \
      -Dotel.javaagent.extensions="$jar" \
      -Dotel.traces.exporter=none \
      -Dotel.metrics.exporter=none \
      -Dotel.logs.exporter=none \
      -Dotel.javaagent.logging=none \
      -Dflowtrace.package-prefix=Bench \
      -Dflowtrace.max-arg-length=512 \
      -Dflowtrace.output="$outfile" \
      Bench)
  rm -f "$outfile"
  instrumented_us[java]="${instr:-0}"
  overhead_pct[java]=$(compute_overhead "${baseline_us[java]}" "${instrumented_us[java]}")

  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------

bench_python() {
  echo "[python] baseline..." >&2
  local base
  base=$(run_and_extract_us python3 "$BENCH_DIR/python/bench.py")
  baseline_us[python]="${base:-0}"

  echo "[python] instrumented..." >&2
  local layer
  layer=$(python3 -c "import flowtrace_runtime" 2>/dev/null && echo installed || true)
  require_built "python" "$layer" "make build-python"
  local instr
  if true; then
    local outfile
    outfile=$(mktemp /tmp/ft-bench-python-XXXXXX.jsonl)
    # The sitecustomize stub, the same entry point `flowtrace run` and the
    # golden runners use. This used to install the import hook and then
    # exec() the source, which never goes through the hook — so the
    # "instrumented" run was the baseline again and python reported ~0%
    # overhead for a program that was never instrumented.
    instr=$(cd "$BENCH_DIR/python" && \
      PYTHONPATH="$REPO_ROOT/capture/python/stub:${PYTHONPATH:-}" \
      FLOWTRACE_ENABLE=1 \
      FLOWTRACE_PACKAGE_PREFIX=bench \
      FLOWTRACE_OUTPUT="$outfile" \
      FLOWTRACE_MAX_ARG_LENGTH=512 \
      run_and_extract_us python3 bench.py)
    rm -f "$outfile"
  fi
  instrumented_us[python]="${instr:-0}"
  overhead_pct[python]=$(compute_overhead "${baseline_us[python]}" "${instrumented_us[python]}")
}

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

bench_node() {
  echo "[node] baseline..." >&2
  local base
  base=$(run_and_extract_us node "$BENCH_DIR/node/bench.js")
  baseline_us[node]="${base:-0}"

  echo "[node] instrumented..." >&2
  local loader="$REPO_ROOT/capture/node/src/bootstrap.mjs"
  [ -f "$loader" ] || loader=""
  require_built "node" "$loader" "make build-node"
  local instr
  if true; then
    local outfile
    outfile=$(mktemp /tmp/ft-bench-node-XXXXXX.jsonl)
    instr=$(FLOWTRACE_OUTPUT="$outfile" \
      FLOWTRACE_MAX_ARG_LENGTH=512 \
      run_and_extract_us node \
        --import "$loader" \
        "$BENCH_DIR/node/bench.js")
    rm -f "$outfile"
  fi
  instrumented_us[node]="${instr:-0}"
  overhead_pct[node]=$(compute_overhead "${baseline_us[node]}" "${instrumented_us[node]}")
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "FlowTrace v2 — Benchmark Harness (10k iterations)"
echo "=================================================="

bench_java
write_result java

bench_python
write_result python

bench_node
write_result node

# Print summary table.
echo ""
echo "Lang     | Baseline (us) | Instrumented (us) | Overhead %"
echo "---------|---------------|-------------------|-----------"
for lang in java python node; do
  gate_var="${lang^^}_GATE"
  gate="${!gate_var}"
  pct="${overhead_pct[$lang]}"
  flag=""
  if [ "$pct" -gt "$gate" ]; then
    flag=" [WARN: >${gate}%]"
  fi
  printf "%-8s | %13s | %17s | %9s%%%s\n" \
    "$lang" \
    "${baseline_us[$lang]}" \
    "${instrumented_us[$lang]}" \
    "$pct" \
    "$flag"
done
echo ""
echo "Gates (informational): Java <${JAVA_GATE}%, Python <${PYTHON_GATE}%, Node <${NODE_GATE}%"
