#!/usr/bin/env bash
# FlowTrace v2 — Truncation parity test across Java, Python, Node.
# Runs each lang with max-arg-length=64 and asserts "<truncated:" appears in JSONL output.
# Exit code: 0 if all 3 pass, 1 if any fail.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLDEN_DIR="$REPO_ROOT/examples/golden/truncation"
MAX_LEN=64
PASS=0
FAIL=0

check_truncation() {
  local lang=$1
  local outfile=$2
  if grep -q '<truncated:' "$outfile" 2>/dev/null; then
    echo "[PASS] $lang: truncation marker found"
    PASS=$(( PASS + 1 ))
  else
    echo "[FAIL] $lang: truncation marker NOT found in $outfile"
    FAIL=$(( FAIL + 1 ))
  fi
}

# ---------------------------------------------------------------------------
# Java
# ---------------------------------------------------------------------------
run_java() {
  local dir="$GOLDEN_DIR/java"
  local jar
  jar=$(ls "$REPO_ROOT/capture/java/flowtrace-otel-extension/target/flowtrace-otel-extension-"*"-SNAPSHOT.jar" 2>/dev/null | grep -v original | head -1 || true)
  if [ -z "$jar" ]; then
    echo "[SKIP] java: agent jar not found (run make build-java first)"
    return
  fi

  local outfile
  outfile=$(mktemp /tmp/ft-trunc-java-XXXXXX.jsonl)
  cd "$dir"
  javac LongArgFixture.java 2>/dev/null
  FLOWTRACE_OUTPUT="$outfile" java \
    -javaagent:"$jar" \
    -Dflowtrace.package-prefix=LongArgFixture \
    -Dflowtrace.max-arg-length=$MAX_LEN \
    LongArgFixture 2>/dev/null || true
  check_truncation java "$outfile"
  rm -f "$outfile"
  cd "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------
run_python() {
  if ! python3 -c "import flowtrace_runtime" 2>/dev/null; then
    echo "[SKIP] python: flowtrace_runtime not installed (run make build-python first)"
    return
  fi

  local outfile
  outfile=$(mktemp /tmp/ft-trunc-python-XXXXXX.jsonl)
  FLOWTRACE_OUTPUT="$outfile" \
  FLOWTRACE_MAX_ARG_LENGTH=$MAX_LEN \
    python3 -c "
import flowtrace_runtime.loader as _l
import importlib.util, sys

spec = importlib.util.spec_from_file_location('long_arg_fixture',
    '$GOLDEN_DIR/python/long_arg_fixture.py',
    loader=_l.FlowtraceSourceLoader('long_arg_fixture',
        '$GOLDEN_DIR/python/long_arg_fixture.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.main()
" 2>/dev/null || \
  FLOWTRACE_OUTPUT="$outfile" \
  FLOWTRACE_MAX_ARG_LENGTH=$MAX_LEN \
    python3 "$GOLDEN_DIR/python/long_arg_fixture.py" 2>/dev/null || true
  check_truncation python "$outfile"
  rm -f "$outfile"
}

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
run_node() {
  local loader="$REPO_ROOT/capture/node/src/bootstrap.mjs"
  if [ ! -f "$loader" ]; then
    echo "[SKIP] node: bootstrap loader not found"
    return
  fi

  local outfile
  outfile=$(mktemp /tmp/ft-trunc-node-XXXXXX.jsonl)
  FLOWTRACE_OUTPUT="$outfile" \
  FLOWTRACE_MAX_ARG_LENGTH=$MAX_LEN \
    node --import "$loader" \
      "$GOLDEN_DIR/node/longArgFixture.js" 2>/dev/null || true
  # Wait for async writes to flush.
  sleep 0.5
  check_truncation node "$outfile"
  rm -f "$outfile"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "FlowTrace v2 — Truncation Parity (max-arg-length=$MAX_LEN)"
echo "============================================================"

run_java
run_python
run_node

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
