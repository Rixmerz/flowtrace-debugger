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
JAVA_GATE=15
PYTHON_GATE=20
NODE_GATE=15

declare -A baseline_ms
declare -A instrumented_ms
declare -A overhead_pct

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

run_and_extract_ms() {
  # Run command, capture stdout, extract BENCH_RESULT_MS=<n>.
  local output
  output=$("$@" 2>/dev/null) || true
  echo "$output" | grep -oE 'BENCH_RESULT_MS=[0-9]+' | cut -d= -f2 || true
}

write_result() {
  local lang=$1
  local file="$BENCH_DIR/results-${lang}-${TIMESTAMP}.json"
  cat > "$file" <<JSON
{
  "lang": "${lang}",
  "timestamp": "${TIMESTAMP}",
  "iterations": 10000,
  "baseline_ms": ${baseline_ms[$lang]},
  "instrumented_ms": ${instrumented_ms[$lang]},
  "overhead_pct": ${overhead_pct[$lang]}
}
JSON
  echo "  Wrote: $file" >&2
}

compute_overhead() {
  local base=$1
  local instr=$2
  if [ "$base" -eq 0 ]; then
    echo 0
  else
    echo $(( (instr - base) * 100 / base ))
  fi
}

# ---------------------------------------------------------------------------
# Java
# ---------------------------------------------------------------------------

bench_java() {
  echo "[java] compiling Bench.java..." >&2
  cd "$BENCH_DIR/java"
  javac Bench.java 2>/dev/null

  echo "[java] baseline..." >&2
  local bms
  bms=$(run_and_extract_ms java Bench)
  baseline_ms[java]="${bms:-0}"

  echo "[java] instrumented..." >&2
  local jar
  jar=$(ls "$REPO_ROOT/capture/java/flowtrace-otel-extension/target/flowtrace-otel-extension-"*"-SNAPSHOT.jar" 2>/dev/null | grep -v original | head -1 || true)
  local ims
  if [ -n "$jar" ]; then
    local outfile
    outfile=$(mktemp /tmp/ft-bench-java-XXXXXX.jsonl)
    ims=$(FLOWTRACE_OUTPUT="$outfile" \
      run_and_extract_ms java \
        -javaagent:"$jar" \
        -Dflowtrace.package-prefix=Bench \
        -Dflowtrace.max-arg-length=512 \
        Bench)
    rm -f "$outfile"
  else
    echo "  [java] agent jar not found, using baseline as instrumented" >&2
    ims=$bms
  fi
  instrumented_ms[java]="${ims:-0}"
  overhead_pct[java]=$(compute_overhead "${baseline_ms[java]}" "${instrumented_ms[java]}")

  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------

bench_python() {
  echo "[python] baseline..." >&2
  local bms
  bms=$(run_and_extract_ms python3 "$BENCH_DIR/python/bench.py")
  baseline_ms[python]="${bms:-0}"

  echo "[python] instrumented..." >&2
  local ims
  if python3 -c "import flowtrace_runtime" 2>/dev/null; then
    local outfile
    outfile=$(mktemp /tmp/ft-bench-python-XXXXXX.jsonl)
    ims=$(FLOWTRACE_OUTPUT="$outfile" \
      FLOWTRACE_MAX_ARG_LENGTH=512 \
      run_and_extract_ms python3 \
        -c "
import flowtrace_runtime.bootstrap as _b; _b.install()
exec(open('$BENCH_DIR/python/bench.py').read())
")
    rm -f "$outfile"
  else
    echo "  [python] flowtrace_runtime not installed, using baseline as instrumented" >&2
    ims=$bms
  fi
  instrumented_ms[python]="${ims:-0}"
  overhead_pct[python]=$(compute_overhead "${baseline_ms[python]}" "${instrumented_ms[python]}")
}

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

bench_node() {
  echo "[node] baseline..." >&2
  local bms
  bms=$(run_and_extract_ms node "$BENCH_DIR/node/bench.js")
  baseline_ms[node]="${bms:-0}"

  echo "[node] instrumented..." >&2
  local loader="$REPO_ROOT/capture/node/src/bootstrap.mjs"
  local ims
  if [ -f "$loader" ]; then
    local outfile
    outfile=$(mktemp /tmp/ft-bench-node-XXXXXX.jsonl)
    ims=$(FLOWTRACE_OUTPUT="$outfile" \
      FLOWTRACE_MAX_ARG_LENGTH=512 \
      run_and_extract_ms node \
        --import "$loader" \
        "$BENCH_DIR/node/bench.js")
    rm -f "$outfile"
  else
    echo "  [node] bootstrap loader not found, using baseline as instrumented" >&2
    ims=$bms
  fi
  instrumented_ms[node]="${ims:-0}"
  overhead_pct[node]=$(compute_overhead "${baseline_ms[node]}" "${instrumented_ms[node]}")
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
echo "Lang     | Baseline (ms) | Instrumented (ms) | Overhead %"
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
    "${baseline_ms[$lang]}" \
    "${instrumented_ms[$lang]}" \
    "$pct" \
    "$flag"
done
echo ""
echo "Gates (informational): Java <${JAVA_GATE}%, Python <${PYTHON_GATE}%, Node <${NODE_GATE}%"
