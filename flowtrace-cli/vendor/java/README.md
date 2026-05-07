# vendor/java — OTel Java agent binary

This directory holds the OpenTelemetry Java agent jar, which is excluded from git (binary).

## Fetching the agent

Run from the `flowtrace-cli/` directory:

```sh
make fetch-deps
# or directly:
sh scripts/fetch-otel-agent.sh
```

This downloads `opentelemetry-javaagent-2.27.0.jar` from Maven Central into this directory
and renames it `opentelemetry-javaagent.jar`. The script is idempotent.

## Why vendored?

The FlowTrace extension jar (`capture/java/.../flowtrace-otel-extension-*.jar`) is an OTel
*extension* — it must be loaded via `-Dotel.javaagent.extensions=<ext>` alongside the main
OTel agent. Both jars are required at runtime. Only the extension jar is built from source;
the upstream agent is downloaded from Maven Central and never committed to git.
