.PHONY: build fetch-deps test

build: fetch-deps
	@echo "  [build] flowtrace-cli listo."

fetch-deps:
	@sh scripts/fetch-otel-agent.sh

test:
	node test/test-cli.js
	node test/test-cli-java.js
