# FlowTrace v2 — root build orchestration.
# Per-subproject builds remain in their own directories; this Makefile
# coordinates cross-cutting tasks (schema validation, top-level test
# aggregation, benchmark harness placeholder).

.PHONY: build test bench validate-schema build-java test-java build-python test-python build-node test-node clean help

help:
	@echo "FlowTrace v2 — top-level targets:"
	@echo "  make build            Build all v2 subprojects (build-java + build-python + build-node)"
	@echo "  make build-java       Build capture/java/flowtrace-otel-extension shaded jar"
	@echo "  make build-python     Install capture/python flowtrace-runtime in editable mode"
	@echo "  make test             Run validate-schema + test-java + test-python + test-node + per-subproject tests"
	@echo "  make test-java        Run JUnit 5 tests for the Java capture module"
	@echo "  make test-python      Run pytest for the Python capture module"
	@echo "  make build-node       Install capture/node npm dependencies"
	@echo "  make test-node        Run node:test suite for the Node capture module"
	@echo "  make bench            Benchmark harness (TODO Sprint 6)"
	@echo "  make validate-schema  Validate examples/golden/*/expected.jsonl vs schema/flowtrace-v2.json"
	@echo "  make clean            Remove transient build/test artifacts"

# Schema validation: Node + Ajv 2020-12 driver in scripts/validate-golden.mjs.
# We install ajv into scripts/node_modules on demand (no global mutation).
validate-schema:
	@echo "==> Installing ajv (if needed) and validating golden fixtures"
	@cd scripts && (test -d node_modules || ( \
	  if command -v pnpm >/dev/null 2>&1; then pnpm install --silent; \
	  elif command -v npm  >/dev/null 2>&1; then npm  install --silent --no-audit --no-fund; \
	  else echo "ERROR: need pnpm or npm to install ajv" >&2; exit 2; fi ))
	@node scripts/validate-golden.mjs

# Top-level test aggregator. v2-only path: schema validation is the
# baseline contract. Per-subproject tests are added as v2 capture
# layers land in S2-S4 (java, python, node, ts).
test: validate-schema test-java test-python test-node
	@echo "==> mcp-server tests"
	@cd mcp-server && node test/test-trace-tools.mjs
	@echo "==> flowtrace-dashboard tests"
	@cd flowtrace-dashboard && node test/test-analyzer.js
	@echo "==> flowtrace-cli tests"
	@cd flowtrace-cli && for t in test/test-cli.js test/test-cli-java.js test/test-cli-python.js test/test-cli-node.js test/test-detect.js test/test-cli-autodetect.js test/test-analyze.js; do node $$t || exit 1; done

# Java capture module
build-java:
	@echo "==> build-java: flowtrace-otel-extension"
	@cd capture/java/flowtrace-otel-extension && mvn -q package

test-java:
	@echo "==> test-java: flowtrace-otel-extension"
	@cd capture/java/flowtrace-otel-extension && mvn -q test

# Python capture module
build-python:
	@echo "==> build-python: flowtrace-runtime (editable install)"
	@cd capture/python && pip install -e . --quiet

test-python:
	@echo "==> test-python: flowtrace-runtime"
	@cd capture/python && python -m pytest tests/ -v

# Node capture module
build-node:
	@echo "==> build-node: @flowtrace/capture-node"
	@cd capture/node && (command -v pnpm >/dev/null 2>&1 && pnpm install --silent || npm install --silent --no-audit --no-fund)

test-node:
	@echo "==> test-node: @flowtrace/capture-node"
	@cd capture/node && node --test test/*.mjs

# Build aggregator.
build: build-java build-python build-node
	@echo "==> build: done"

# Benchmark harness — Sprint 6.
bench:
	@bash benchmarks/run-bench.sh

clean:
	@echo "==> clean: removing scripts/node_modules"
	@rm -rf scripts/node_modules
