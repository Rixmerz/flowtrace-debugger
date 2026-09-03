.PHONY: build fetch-deps test

build: fetch-deps
	@echo "  [build] flowtrace-cli listo."

fetch-deps:
	@sh scripts/fetch-otel-agent.sh

# Glob, like the root Makefile: a hardcoded list ran 2 of 13 files, so a
# contributor running `make test` here got a green run over 15% of the suite.
test:
	@for t in test/*.js; do echo "-- $$t"; node "$$t" || exit 1; done
