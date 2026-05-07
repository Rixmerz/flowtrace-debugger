# FlowTrace v2 — root build orchestration.
# Per-subproject builds remain in their own directories; this Makefile
# coordinates cross-cutting tasks (schema validation, top-level test
# aggregation, benchmark harness placeholder).

.PHONY: build test bench validate-schema clean help

help:
	@echo "FlowTrace v2 — top-level targets:"
	@echo "  make build            Build v2 subprojects (placeholder until S1+ land)"
	@echo "  make test             Run validate-schema plus per-subproject tests"
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
test: validate-schema
	@echo "==> mcp-server tests"
	@cd mcp-server && node test/test-trace-tools.mjs
	@echo "==> flowtrace-dashboard tests"
	@cd flowtrace-dashboard && node test/test-analyzer.js
	@echo "==> flowtrace-cli tests"
	@cd flowtrace-cli && node test/test-cli.js

# Build aggregator placeholder.
build:
	@echo "==> build: nothing wired at root level yet (per-subproject builds remain local)"

# Benchmark harness — planned for Sprint 6.
bench:
	@echo "TODO S6: bench harness (10k call hot loop per lang vs baseline)"

clean:
	@echo "==> clean: removing scripts/node_modules"
	@rm -rf scripts/node_modules
