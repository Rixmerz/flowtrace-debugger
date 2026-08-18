# @rixmerz/flowtrace

Trace what your program actually did — Java, Node, TypeScript and Python — and
read the result with an AI agent instead of guessing from source.

```bash
npm i -g @rixmerz/flowtrace

flowtrace run -- python app.py
flowtrace run -- node server.js
flowtrace run -- java -jar app.jar
```

That is the whole setup. **No Maven, no pip, no clone.**

## Why one package

The capture layers ship inside this package: the Python runtime as plain `.py`
files placed on `PYTHONPATH` (it needs no installation at all), the Node and
browser layers as source, and the Java agent as its shaded jar. One `npm i`
therefore installs every runtime's capture at once, and — more importantly —
they can never drift out of version with each other, which matters because all
of them lock to the same trace schema.

The one thing not bundled is the OpenTelemetry javaagent: it is ~24 MB and not
ours, so it is downloaded on first Java use and cached in `~/.flowtrace/`. If
you never trace Java, it is never fetched.

## Commands

| Command | Purpose |
|---------|---------|
| `flowtrace init` | Detect the project type and write `.flowtrace/config.json` |
| `flowtrace run -- <cmd>` | Run a command under instrumentation |
| `flowtrace analyze` | Open the trace in the dashboard |

`run` auto-detects the language and the package prefix. Override either with
`--lang` and `--package-prefix`; the prefix matters more than it sounds, since
without one every framework and stdlib call lands in the trace.

Output goes to `.flowtrace/<timestamp>.jsonl` — one JSON object per line,
schema `flowtrace-v2`.

## Reading the trace

The [FlowTrace Claude Code plugin](https://github.com/Rixmerz/flowtrace-debugger/tree/main/plugin)
gives an agent `log.*` and `trace.*` tools over the file, plus a skill that
teaches it what the fields mean. Without it the trace is still plain JSONL —
`jq` works fine:

```bash
jq -s 'map(select(.event=="exit")) | sort_by(-.duration_ns) | .[:10]' .flowtrace/*.jsonl
```

## Configuration

| Variable | Effect |
|----------|--------|
| `FLOWTRACE_PACKAGE_PREFIX` | Restrict instrumentation to matching modules |
| `FLOWTRACE_MAX_ARG_LENGTH` | Truncate args/results (`0` disables, default 512) |
| `FLOWTRACE_TRACEPARENT` | Continue a trace started by another process |
| `FLOWTRACE_CACHE_DIR` | Where the OTel agent is cached (default `~/.flowtrace`) |
| `FLOWTRACE_PROPAGATE=0` | Disable automatic outgoing trace propagation |

## Developing

From a checkout the CLI resolves the capture layers from `capture/` instead of
its vendored copies, so your edits take effect with no flag and no reinstall.

```bash
make build            # build every capture layer
npm run vendor        # copy them into vendor/ as a publish would
npm pack              # runs vendor automatically via prepack
```

MIT.
