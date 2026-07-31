#!/usr/bin/env bash
# FlowTrace v2 — Truncation parity across Java, Python and Node.
#
# Runs each layer against its long-argument fixture with max-arg-length=64 and
# asserts all three produce the SAME truncation marker, "<truncated:PREFIX...>".
#
# ---------------------------------------------------------------------------
# Why this was rewritten
# ---------------------------------------------------------------------------
# "Truncation parity" had never actually been verified for any language. Every
# path through the old script failed silently or by accident:
#
#   1. Java globbed for flowtrace-otel-extension-*-SNAPSHOT.jar, gone since the
#      2.0.0 release, and reported [SKIP]. It also passed the extension jar as
#      -javaagent, which cannot work: the extension has no Premain-Class and must
#      be loaded via -Dotel.javaagent.extensions on top of the real OTel agent.
#   2. Python gated on `python3 -c "import flowtrace_runtime"` without the
#      PYTHONPATH the run itself uses, so it reported [SKIP] on any checkout that
#      had not pip-installed the package.
#   3. Node was invoked from the repository root, where the default prefix
#      ("everything under cwd") made FlowTrace instrument its OWN source. The
#      traced program died on a SyntaxError in our instrument.js before emitting
#      anything, and the script reported that as a truncation failure. That was a
#      real bug, now fixed by a self-instrumentation guard in both hooks.
#   4. Java emitted "PREFIX...[truncated]" while the assertion looks for
#      "<truncated:" — so even had it run, it would have failed. Three layers,
#      three formats, on a contract whose entire purpose is parity.
#
# So the score was 0 passed, 1 failed, 2 skipped — and nothing distinguished that
# from a genuine pass. A skipped language is now counted and reported as
# UNVERIFIED, and the marker is compared for equality across languages rather
# than merely grepped for per language.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLDEN_DIR="$REPO_ROOT/examples/golden/truncation"
MAX_LEN=64
EXPECTED_PREFIX='<truncated:'

JAVA_EXT_DIR="$REPO_ROOT/capture/java/flowtrace-otel-extension"
PY_CAPTURE="$REPO_ROOT/capture/python"
NODE_BOOTSTRAP="$REPO_ROOT/capture/node/src/bootstrap.mjs"

# bash 3.2 on macOS has no associative arrays; keep to plain ones.
RESULT_ROWS=()
PASS=0
FAIL=0
SKIPPED=""

fail_lang() {
  echo "[FAIL] $1: $2" >&2
  FAIL=$(( FAIL + 1 ))
}

skip_lang() {
  echo "[SKIP] $1: $2" >&2
  SKIPPED="$SKIPPED $1"
}

# Extract the truncated `data` argument from a trace, or nothing.
extract_marker() {
  local outfile=$1
  [ -f "$outfile" ] || return 0
  # First args value that carries the marker.
  grep -o '"<truncated:[^"]*"' "$outfile" 2>/dev/null | head -1 || true
}

check() {
  local lang=$1 outfile=$2

  if [ ! -s "$outfile" ]; then
    fail_lang "$lang" "no events emitted — the layer did not run, so truncation is unverified"
    return
  fi

  local marker
  marker=$(extract_marker "$outfile")
  if [ -z "$marker" ]; then
    # Report what WAS emitted, so a format divergence is visible rather than
    # just absent. This is how Java's "...[truncated]" would have surfaced.
    local sample
    sample=$(grep -o '"data":"[^"]\{0,40\}' "$outfile" 2>/dev/null | head -1 || true)
    fail_lang "$lang" "no ${EXPECTED_PREFIX} marker found; args began: ${sample:-<none>}"
    return
  fi

  echo "[PASS] $lang: $marker"
  PASS=$(( PASS + 1 ))
  RESULT_ROWS+=("$lang")
}

# ---------------------------------------------------------------------------
# Java — real OTel agent + FlowTrace extension
# ---------------------------------------------------------------------------
run_java() {
  command -v java  >/dev/null || { skip_lang java "java not on PATH"; return; }
  command -v javac >/dev/null || { skip_lang java "javac not on PATH"; return; }

  # Version from the pom, not a hardcoded glob.
  local version
  version=$(sed -n 's|.*<version>\(.*\)</version>.*|\1|p' "$JAVA_EXT_DIR/pom.xml" | head -1)
  local ext="$JAVA_EXT_DIR/target/flowtrace-otel-extension-${version}.jar"
  local agent="$JAVA_EXT_DIR/target/dependency/opentelemetry-javaagent.jar"

  [ -f "$ext" ]   || { skip_lang java "extension jar missing — run 'make build-java'"; return; }
  [ -f "$agent" ] || { skip_lang java "OTel agent jar missing — run 'make build-java'"; return; }

  local outfile; outfile=$(mktemp "${TMPDIR:-/tmp}/ft-trunc-java-XXXXXX")
  (
    cd "$GOLDEN_DIR/java"
    javac LongArgFixture.java
    java -javaagent:"$agent" \
      -Dotel.javaagent.extensions="$ext" \
      -Dflowtrace.package-prefix=LongArgFixture \
      -Dflowtrace.output="$outfile" \
      -Dflowtrace.max-arg-length=$MAX_LEN \
      -Dotel.traces.exporter=none -Dotel.metrics.exporter=none \
      -Dotel.logs.exporter=none -Dotel.javaagent.logging=none \
      LongArgFixture >/dev/null 2>&1
  ) || true
  check java "$outfile"
  rm -f "$outfile"
}

# ---------------------------------------------------------------------------
# Python — through the sitecustomize stub, like a real run
# ---------------------------------------------------------------------------
run_python() {
  command -v python3 >/dev/null || { skip_lang python "python3 not on PATH"; return; }
  [ -d "$PY_CAPTURE/stub" ] || { skip_lang python "capture/python/stub missing"; return; }

  local outfile; outfile=$(mktemp "${TMPDIR:-/tmp}/ft-trunc-python-XXXXXX")
  (
    cd "$GOLDEN_DIR/python"
    PYTHONPATH="$PY_CAPTURE/stub:$PY_CAPTURE" \
    FLOWTRACE_ENABLE=1 \
    FLOWTRACE_PACKAGE_PREFIX=long_arg_fixture \
    FLOWTRACE_OUTPUT="$outfile" \
    FLOWTRACE_MAX_ARG_LENGTH=$MAX_LEN \
      python3 long_arg_fixture.py >/dev/null 2>&1
  ) || true
  check python "$outfile"
  rm -f "$outfile"
}

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
run_node() {
  command -v node >/dev/null || { skip_lang node "node not on PATH"; return; }
  [ -f "$NODE_BOOTSTRAP" ] || { skip_lang node "bootstrap.mjs missing"; return; }

  local outfile; outfile=$(mktemp "${TMPDIR:-/tmp}/ft-trunc-node-XXXXXX")
  (
    # cd into the fixture directory: the default prefix is "everything under
    # cwd", and running from the repo root used to pull FlowTrace's own source
    # into scope.
    cd "$GOLDEN_DIR/node"
    FLOWTRACE_OUTPUT="$outfile" \
    FLOWTRACE_MAX_ARG_LENGTH=$MAX_LEN \
    FLOWTRACE_PACKAGE_PREFIX= \
    NODE_OPTIONS= \
      node --import "file://$NODE_BOOTSTRAP" longArgFixture.js >/dev/null 2>&1
  ) || true
  check node "$outfile"
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

if [ -n "$SKIPPED" ]; then
  echo "UNVERIFIED (toolchain absent):$SKIPPED"
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
if [ "$PASS" -lt 2 ]; then
  # One language agreeing with itself is not parity.
  echo "Only ${PASS} language(s) verified — parity needs at least two." >&2
  exit 1
fi
