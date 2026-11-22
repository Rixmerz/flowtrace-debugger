#!/usr/bin/env bash
# Rust overhead benchmark: the same program built plainly and through flowtrace-rust.
#
# Usage: bash benchmarks/rust/run.sh [runs]     (default 5; the median of each is reported)
# Prints one JSON object. Needs `make build-rust` first.
#
# Instrumented runs write to /dev/null with the event cap off: that measures what
# FlowTrace itself costs (formatting, the lock, buffering, a write per 64 KiB)
# without also measuring this machine's disk. A real file adds the page-cache copy
# of the bytes; the trace is roughly 330 bytes per call (two events).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DRIVER="$ROOT/capture/rust/target/release/flowtrace-rust"
RUNS="${1:-5}"
TARGET="${FLOWTRACE_BENCH_TARGET:-$ROOT/capture/rust/target/bench}"

[ -x "$DRIVER" ] || { echo "flowtrace-rust is not built: run 'make build-rust'" >&2; exit 1; }

export RUSTC_WRAPPER=""   # a configured sccache would sit in front of the driver's wrapper

echo "[rust] building baseline..." >&2
CARGO_TARGET_DIR="$TARGET/plain" cargo build --release --quiet --manifest-path "$HERE/Cargo.toml"
BASE="$TARGET/plain/release/bench"

echo "[rust] building instrumented..." >&2
CARGO_TARGET_DIR="$TARGET/instr" "$DRIVER" --dir "$HERE" --capture-dir "$ROOT/capture/rust" \
  --package-prefix bench_lib cargo build --release --quiet >&2
INSTR="$(ls -d "$TARGET"/instr/flowtrace-*/build/release/bench | head -1)"

# `key` of the BENCH_RUST line, median over $RUNS runs of the given command.
median() { # key cmd...
  local key=$1; shift
  for _ in $(seq "$RUNS"); do "$@" | grep BENCH_RUST | tr ' ' '\n' | grep "^$key=" | cut -d= -f2; done \
    | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}'
}

measure() { # label, env assignments..., then the binary
  local label=$1; shift
  echo "[rust] $label..." >&2
  local out=""
  for key in root_ns nested_ns store_ns store_ms; do
    out+="\"$key\": $(median "$key" env "$@"), "
  done
  echo "${out%, }"
}

OFF="FLOWTRACE_OUTPUT=/dev/null FLOWTRACE_MAX_EVENTS=0"
BASELINE=$(measure baseline "$BASE")
VALUES=$(measure "instrumented (values on)" $OFF "$INSTR")
NOVALUES=$(measure "instrumented (FLOWTRACE_CAPTURE_ARGS=0)" $OFF FLOWTRACE_CAPTURE_ARGS=0 "$INSTR")
CAPPED=$(measure "instrumented (default 100000-event cap, past the cap)" FLOWTRACE_OUTPUT=/dev/null "$INSTR")

cat <<JSON
{
  "lang": "rust",
  "runs": $RUNS,
  "workloads": {
    "root_ns": "1M calls of a trivial fn, each its own root span (worst case)",
    "nested_ns": "1M calls of a trivial fn inside one root span",
    "store_ns": "200k point-read-like calls (2 spans each: get -> checksum), ~hundreds of ns of work"
  },
  "unit": "ns per call of the workload (store_ms: total milliseconds)",
  "baseline": { $BASELINE },
  "instrumented": { $VALUES },
  "instrumented_no_values": { $NOVALUES },
  "instrumented_past_event_cap": { $CAPPED }
}
JSON
