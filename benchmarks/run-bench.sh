#!/usr/bin/env bash
# FlowTrace v2 benchmark harness — 10k hot-loop per lang × (baseline | instrumented).
#
# Usage: bash benchmarks/run-bench.sh [java|python|node ...]
# Outputs: benchmarks/results-<lang>-<timestamp>.json (one per lang) + a summary.
#
# ---------------------------------------------------------------------------
# Why this was rewritten
# ---------------------------------------------------------------------------
# The previous harness could not measure anything, and every failure mode
# reported 0% overhead:
#
#   1. It looked for flowtrace-otel-extension-*-SNAPSHOT.jar, which stopped
#      existing when the project was released to 2.0.0.
#   2. It passed the extension jar as -javaagent. The extension has no
#      Premain-Class; it is an OTel javaagent *extension* and must be loaded via
#      -Dotel.javaagent.extensions on top of the real agent.
#   3. Python was instrumented with exec(open(...).read()) after install(). The
#      import hook only rewrites *imported modules*, so exec'd source was never
#      instrumented at all.
#   4. FLOWTRACE_PACKAGE_PREFIX was never set. Python and Java instrument
#      NOTHING without it.
#   5. Each of those fell back to `instrumented = baseline`, and
#      compute_overhead() returned 0 whenever the baseline was 0 — so total
#      failure was indistinguishable from zero cost. All six committed
#      results-*.json files were that no-op.
#   6. Overhead was expressed as a percentage. An uninstrumented 10k loop of
#      add() runs in well under a millisecond, so the percentage is either a
#      division by ~0 or meaningless. The advertised gates (<15% / <20%) were not
#      merely unverified, they were unexpressible.
#
# So: the primary metric here is COST PER EVENT in microseconds, which is the
# figure that transfers to a real workload — multiply it by how many traced calls
# a request makes. Absolute wall-clock times are reported alongside it, and the
# percentage is deliberately NOT reported.
#
# The load-bearing assertion is that an instrumented run must actually emit
# events. That single check catches every defect listed above, all of which
# previously presented as "0% overhead".
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BENCH_DIR="$REPO_ROOT/benchmarks"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
ITERATIONS=10000

# Per-event cost ceilings, in microseconds. These are honest placeholders taken
# from a first real measurement, not vendor claims — move them deliberately when
# the numbers move, and say why in the commit.
JAVA_GATE_US=40
PYTHON_GATE_US=40
NODE_GATE_US=15

JAVA_EXT_DIR="$REPO_ROOT/capture/java/flowtrace-otel-extension"
PY_CAPTURE="$REPO_ROOT/capture/python"
NODE_BOOTSTRAP="$REPO_ROOT/capture/node/src/bootstrap.mjs"

# Plain indexed arrays only: macOS ships bash 3.2, which has no associative
# arrays and no ${var^^} uppercase expansion. The previous harness used both, so
# it aborted immediately on macOS and only ever ran in CI — where it produced the
# 0%% no-op results that are the reason this file was rewritten.
SUMMARY_ROWS=()

failures=0
skipped=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die_lang() {
  # Record a hard failure for one language. Never substitutes a fake number.
  local lang=$1 reason=$2
  echo "  [$lang] FAIL: $reason" >&2
  failures=$((failures + 1))
}

skip_lang() {
  # Toolchain genuinely absent. Reported and counted — never silently passed.
  local lang=$1 reason=$2
  echo "  [$lang] SKIP: $reason" >&2
  skipped="$skipped $lang"
}

extract_ns() {
  # Run a command and echo the BENCH_RESULT_NS it printed, or nothing.
  local output
  if ! output=$("$@" 2>/dev/null); then
    return 1
  fi
  echo "$output" | grep -oE 'BENCH_RESULT_NS=[0-9]+' | cut -d= -f2 | head -1
}

count_events() {
  local file=$1
  if [ -f "$file" ]; then wc -l < "$file" | tr -d ' '; else echo 0; fi
}

# Microseconds per emitted event. awk, because bash integer division cannot
# express a sub-microsecond figure.
per_event_us() {
  local base_ns=$1 instr_ns=$2 n_events=$3
  awk -v b="$base_ns" -v i="$instr_ns" -v n="$n_events" \
    'BEGIN { if (n <= 0) { print "0.000" } else { printf "%.3f", (i - b) / n / 1000 } }'
}

gate_for() {
  # bash 3.2 has no ${var^^}, so uppercase via tr and dereference indirectly.
  local upper
  upper=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  eval "printf '%s' \"\${${upper}_GATE_US}\""
}

record() {
  local lang=$1 base_ns=$2 instr_ns=$3 n_events=$4
  local file="$BENCH_DIR/results-${lang}-${TIMESTAMP}.json"
  local us gate verdict
  us=$(per_event_us "$base_ns" "$instr_ns" "$n_events")
  gate=$(gate_for "$lang")
  verdict=$(awk -v v="$us" -v g="$gate" 'BEGIN { print (v > g) ? "WARN" : "ok" }')

  cat > "$file" <<JSON
{
  "lang": "${lang}",
  "timestamp": "${TIMESTAMP}",
  "iterations": ${ITERATIONS},
  "baseline_ns": ${base_ns},
  "instrumented_ns": ${instr_ns},
  "events_emitted": ${n_events},
  "us_per_event": ${us},
  "gate_us": ${gate},
  "within_gate": $([ "$verdict" = "ok" ] && echo true || echo false)
}
JSON
  echo "  Wrote: ${file#"$REPO_ROOT"/}" >&2

  SUMMARY_ROWS+=("$(printf '%-8s | %13s | %17s | %7s | %8s | %s' \
    "$lang" \
    "$(awk -v n="$base_ns"  'BEGIN { printf "%.2f", n/1e6 }')" \
    "$(awk -v n="$instr_ns" 'BEGIN { printf "%.2f", n/1e6 }')" \
    "$n_events" \
    "$us" \
    "$verdict (<${gate}us)")")
}

# Shared post-run validation. An instrumented run that emitted nothing was not
# instrumented, whatever the clock says.
finish_lang() {
  local lang=$1 outfile=$2 bns=$3 ins=$4

  if [ -z "$bns" ]; then die_lang "$lang" "baseline produced no BENCH_RESULT_NS"; return 1; fi
  if [ -z "$ins" ]; then die_lang "$lang" "instrumented run produced no BENCH_RESULT_NS"; return 1; fi

  local n
  n=$(count_events "$outfile")
  if [ "$n" -eq 0 ]; then
    die_lang "$lang" "instrumented run emitted 0 events — it was NOT instrumented"
    return 1
  fi

  record "$lang" "$bns" "$ins" "$n"
}

# ---------------------------------------------------------------------------
# Java — real OTel agent + FlowTrace extension
# ---------------------------------------------------------------------------

bench_java() {
  command -v java  >/dev/null || { skip_lang java "java not on PATH"; return; }
  command -v javac >/dev/null || { skip_lang java "javac not on PATH"; return; }

  # Derive the version from the pom rather than globbing for a hardcoded one.
  local version
  version=$(sed -n 's|.*<version>\(.*\)</version>.*|\1|p' "$JAVA_EXT_DIR/pom.xml" | head -1)
  local ext="$JAVA_EXT_DIR/target/flowtrace-otel-extension-${version}.jar"
  local agent="$JAVA_EXT_DIR/target/dependency/opentelemetry-javaagent.jar"

  [ -f "$ext" ]   || { skip_lang java "extension jar missing ($ext) — run 'make build-java'"; return; }
  [ -f "$agent" ] || { skip_lang java "OTel agent jar missing — run 'make build-java'"; return; }

  cd "$BENCH_DIR/java"
  javac Bench.java

  echo "[java] baseline..." >&2
  local bns; bns=$(extract_ns java Bench) || true

  echo "[java] instrumented..." >&2
  local out; out=$(mktemp /tmp/ft-bench-java-XXXXXX.jsonl)
  local ins; ins=$(extract_ns java \
    -javaagent:"$agent" \
    -Dotel.javaagent.extensions="$ext" \
    -Dflowtrace.package-prefix=Bench \
    -Dflowtrace.output="$out" \
    -Dflowtrace.max-arg-length=512 \
    -Dotel.traces.exporter=none -Dotel.metrics.exporter=none \
    -Dotel.logs.exporter=none -Dotel.javaagent.logging=none \
    Bench) || true

  finish_lang java "$out" "$bns" "$ins" || true
  rm -f "$out"
  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Python — via the sitecustomize stub, so the main module really is transformed
# ---------------------------------------------------------------------------

bench_python() {
  command -v python3 >/dev/null || { skip_lang python "python3 not on PATH"; return; }
  [ -d "$PY_CAPTURE/stub" ] || { skip_lang python "capture/python/stub missing"; return; }

  cd "$BENCH_DIR/python"

  echo "[python] baseline..." >&2
  local bns; bns=$(extract_ns python3 bench.py) || true

  echo "[python] instrumented..." >&2
  local out; out=$(mktemp /tmp/ft-bench-python-XXXXXX.jsonl)
  # The import hook cannot see __main__, so the stub re-runs the script through
  # runpy with the transformed loader. FLOWTRACE_PACKAGE_PREFIX is mandatory:
  # Python instruments nothing when it is unset.
  local ins
  ins=$(PYTHONPATH="$PY_CAPTURE/stub:$PY_CAPTURE" \
        FLOWTRACE_ENABLE=1 \
        FLOWTRACE_PACKAGE_PREFIX=bench \
        FLOWTRACE_OUTPUT="$out" \
        FLOWTRACE_MAX_ARG_LENGTH=512 \
        extract_ns python3 bench.py) || true

  finish_lang python "$out" "$bns" "$ins" || true
  rm -f "$out"
  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

bench_node() {
  command -v node >/dev/null || { skip_lang node "node not on PATH"; return; }
  [ -f "$NODE_BOOTSTRAP" ] || { skip_lang node "bootstrap.mjs missing"; return; }

  cd "$BENCH_DIR/node"

  echo "[node] baseline..." >&2
  local bns; bns=$(extract_ns node bench.js) || true

  echo "[node] instrumented..." >&2
  local out; out=$(mktemp /tmp/ft-bench-node-XXXXXX.jsonl)
  # Empty prefix = everything under cwd, which is what we want here. NODE_OPTIONS
  # is cleared so the bootstrap is not imported twice.
  local ins
  ins=$(FLOWTRACE_OUTPUT="$out" \
        FLOWTRACE_PACKAGE_PREFIX= \
        FLOWTRACE_MAX_ARG_LENGTH=512 \
        NODE_OPTIONS= \
        extract_ns node --import "file://$NODE_BOOTSTRAP" bench.js) || true

  finish_lang node "$out" "$bns" "$ins" || true
  rm -f "$out"
  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

LANGS=("$@")
[ ${#LANGS[@]} -eq 0 ] && LANGS=(java python node)

echo "FlowTrace v2 — Benchmark Harness (${ITERATIONS} iterations)"
echo "=========================================================="

for lang in "${LANGS[@]}"; do
  case "$lang" in
    java)   bench_java ;;
    python) bench_python ;;
    node)   bench_node ;;
    *) echo "unknown lang: $lang" >&2; exit 2 ;;
  esac
done

echo ""
echo "Lang     | Baseline (ms) | Instrumented (ms) |  Events | us/event | Gate"
echo "---------|---------------|-------------------|---------|----------|--------------"
if [ ${#SUMMARY_ROWS[@]} -eq 0 ]; then
  echo "(nothing measured)"
else
  for row in "${SUMMARY_ROWS[@]}"; do echo "$row"; done
fi

echo ""
echo "us/event = added wall-clock per emitted trace event. Multiply by the number of"
echo "traced calls in a request to estimate real-world cost. Percentage overhead is"
echo "intentionally NOT reported: the uninstrumented loop runs in well under a"
echo "millisecond, so any percentage is a division by approximately zero."

if [ -n "$skipped" ]; then
  echo ""
  echo "SKIPPED (toolchain absent, therefore UNVERIFIED):$skipped"
fi

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "$failures language(s) failed to measure. See messages above." >&2
  exit 1
fi
