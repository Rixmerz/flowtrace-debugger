# Security

## Reporting a vulnerability

Email **jpablo@rixmerz.dev** with what you found and how to reproduce it.
Please do not open a public issue first. Expect an acknowledgement within a few
days; if you have not heard back in a week, send a reminder — it means the mail
went astray, not that the report was ignored.

There is no bounty program. Credit in the CHANGELOG if you want it.

## What a trace contains, and why that matters

FlowTrace records the **arguments and return values of your functions**, and
writes them to a file whose whole purpose is to be read by a tool and pasted
into a conversation with a model. Treat `flowtrace.jsonl` and `.flowtrace/*.jsonl`
as sensitive by default:

- **Do not commit traces.** `flowtrace init` and `flowtrace run` add
  `.flowtrace/` to your `.gitignore` for this reason.
- **Read one before sharing it.** Redaction (below) catches values by *name*.
  A secret passed as a positional argument called `arg0`, or embedded in a URL
  path segment, is not caught by any rule.

### What is redacted automatically

Every file-writing capture layer replaces a value with `<redacted>` when its
argument name — or a nested key inside it — contains any of:

```
password  secret  token  authorization  api_key  dsn  connection_string  email  url
```

matched case-insensitively as a substring, in `args` and `result` alike. Add
more with `FLOWTRACE_REDACT_KEYS` (comma-separated; it extends the list rather
than replacing it). Details in [TRUNCATION_SYSTEM.md](./TRUNCATION_SYSTEM.md).

This has failed before and the fix shipped in 3.3.0: a traced Go HTTP handler
serialized its whole `*http.Request`, which renders the header map — so
`Authorization` and `Cookie` went into the file on every request. Handlers now
record `http.method` and `http.path` instead.

## The dashboard is a local tool

`flowtrace-dashboard` reads trace files, accepts uploads and appends
browser-reported spans. It has **no authentication**. It therefore:

- binds `127.0.0.1` by default (`FLOWTRACE_DASHBOARD_HOST` to widen, with a
  printed warning),
- reads paths only inside the directory it was started in plus
  `FLOWTRACE_DASHBOARD_ROOTS`, resolved through `realpath` so a symlink cannot
  escape,
- stores uploads under server-chosen random names, size-capped.

Do not put it on a network. If you need to, put it behind something that
authenticates.

## The OpenTelemetry javaagent

Tracing Java downloads the OTel javaagent (~24 MB) into `~/.flowtrace/` and
passes it to the JVM as `-javaagent:`, i.e. it runs before your `main()`. The
download is verified against a SHA-256 pinned in `flowtrace-cli/lib/assets.js`
and `flowtrace-cli/scripts/fetch-otel-agent.sh`; a mismatch is discarded rather
than loaded, and redirects are followed only to `https`.

## Instrumented code is code

Both the Node and Python layers cache **rewritten copies of your source** under
`~/.flowtrace/cache/`, and load them. Those directories are created `0700` with
`0600` files: anyone who can write into them can execute code in every traced
process on that machine.

The Go layer never writes into your source tree — it stages rewritten copies in
a private temporary directory (`0700`/`0600`) and hands them to the compiler via
`go build -overlay`.

## Supported versions

Fixes go onto the current release line. There are no long-term support
branches; upgrade to the latest `@rixmerz/flowtrace`.
