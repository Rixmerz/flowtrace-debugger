# FlowTrace v2 — root build orchestration.
# Per-subproject builds remain in their own directories; this Makefile
# coordinates cross-cutting tasks (schema validation, top-level test
# aggregation, benchmark harness placeholder).

.PHONY: build test bench validate-schema check-golden gen-golden \
        build-java test-java build-python test-python build-node test-node \
        build-mcp test-mcp test-dashboard test-cli clean help

help:
	@echo "FlowTrace v2 — top-level targets:"
	@echo "  make build            Build all v2 subprojects (build-java + build-python + build-node)"
	@echo "  make build-java       Build capture/java/flowtrace-otel-extension shaded jar"
	@echo "  make build-python     Install capture/python flowtrace-runtime in editable mode"
	@echo "  make build-node       Install capture/node dependencies"
	@echo "  make build-mcp        Install + compile mcp-server (tsc -> dist/)"
	@echo "  make test             Full suite: schema + golden + java + python + node + mcp + dashboard + cli"
	@echo "  make test-java        Run JUnit 5 tests for the Java capture module"
	@echo "  make test-python      Run pytest for the Python capture module"
	@echo "  make test-node        Run node:test suite for the Node capture module"
	@echo "  make test-mcp         Build and test the MCP server"
	@echo "  make test-dashboard   Run the dashboard analyzer tests"
	@echo "  make test-cli         Run the flowtrace-cli test files"
	@echo "  make validate-schema  Validate examples/golden/**/expected.jsonl vs schema/flowtrace-v2.json"
	@echo "  make check-golden     Re-run every capture and diff against its committed golden fixture"
	@echo "  make gen-golden       Regenerate the golden fixtures from the real capture layers"
	@echo "  make bench            Benchmark harness"
	@echo "  make clean            Remove transient build/test artifacts"

# Schema validation: Node + Ajv 2020-12 driver in scripts/validate-golden.mjs.
# We install ajv into scripts/node_modules on demand (no global mutation).
validate-schema:
	@echo "==> Installing workspace deps (if needed) and validating golden fixtures"
	@test -d scripts/node_modules || pnpm install --silent
	@node scripts/validate-golden.mjs

# Golden regression: re-run every capture layer and diff the normalized
# output against the committed fixture. validate-schema only proves each
# event is well-shaped; this proves the trace itself has not drifted.
check-golden:
	@echo "==> check-golden: re-running captures and diffing against fixtures"
	@node scripts/check-golden.mjs

# Regenerate fixtures. Intentionally NOT part of `make test` — a target that
# rewrites the thing it is checking cannot also be the check.
gen-golden:
	@echo "==> gen-golden: regenerating fixtures from the real capture layers"
	@node scripts/gen-golden.mjs

# Top-level test aggregator. Every subproject that has tests runs here, so
# `make test` and CI cover the same ground.
test: validate-schema check-golden test-java test-python test-node test-mcp test-dashboard test-cli
	@echo "==> test: all suites passed"

# Java capture module
build-java:
	@echo "==> build-java: flowtrace-otel-extension"
	@cd capture/java/flowtrace-otel-extension && mvn -q package

# Depends on build-java so the shaded jar and the OTel agent jar exist:
# without them FlowtraceIntegrationTest assumes itself away. -Dflowtrace.it.required
# turns that self-skip into a hard failure, because a green run that quietly
# skipped its only end-to-end test is what let the Java path rot unnoticed.
test-java: build-java
	@echo "==> test-java: flowtrace-otel-extension"
	@cd capture/java/flowtrace-otel-extension && mvn -q test -Dflowtrace.it.required=true

# Python capture module
build-python:
	@echo "==> build-python: flowtrace-runtime (editable install)"
	@cd capture/python && pip install -e .[dev] --quiet

test-python:
	@echo "==> test-python: flowtrace-runtime"
	@cd capture/python && python -m pytest tests/ -v

# Node capture module
build-node:
	@echo "==> build-node: @flowtrace/capture-node"
	@pnpm --filter @flowtrace/capture-node install --silent

test-node:
	@echo "==> test-node: @flowtrace/capture-node"
	@cd capture/node && node --test test/*.mjs

# MCP server. `npm test` there already runs the build, but the aggregator
# used to invoke the test file directly and so ran it against a dist/ that
# had never been compiled — ERR_MODULE_NOT_FOUND on every run.
build-mcp:
	@echo "==> build-mcp: @flowtrace/mcp-server"
	@cd mcp-server && pnpm install --silent && pnpm run build

test-mcp: build-mcp
	@echo "==> test-mcp: @flowtrace/mcp-server"
	@cd mcp-server && node test/test-trace-tools.mjs

test-dashboard:
	@echo "==> test-dashboard: flowtrace-dashboard"
	@cd flowtrace-dashboard && pnpm install --silent && node test/test-analyzer.js

# Glob rather than a hardcoded file list, so a newly added test file is picked
# up here and in CI instead of being silently left out of both.
test-cli:
	@echo "==> test-cli: flowtrace-cli"
	@cd flowtrace-cli && pnpm install --silent && for t in test/*.js; do node $$t || exit 1; done

# Build aggregator.
build: build-java build-python build-node build-mcp
	@echo "==> build: done"

# Benchmark harness — Sprint 6.
bench:
	@bash benchmarks/run-bench.sh

clean:
	@echo "==> clean: removing workspace node_modules and build output"
	@rm -rf node_modules scripts/node_modules capture/node/node_modules \
	        flowtrace-cli/node_modules flowtrace-dashboard/node_modules \
	        mcp-server/node_modules mcp-server/dist
