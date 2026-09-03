# Truncation and redaction

How FlowTrace v2 keeps a single oversized argument from dominating a trace, and
keeps a credential out of one entirely.

> This document previously described a v1 design in which oversized values were
> written to per-event side files under `flowtrace-jsonsl/` and referenced from
> the trace by a `fullLogFile` path, configured with `FLOWTRACE_SEGMENT_DIRECTORY`.
> **None of that exists in v2.** No capture layer implements a segment
> directory, writes side files, or emits `fullLogFile`. What follows is what the
> code actually does.

## The rule

Each capture layer serializes a value to JSON. If the resulting string is longer
than the configured limit, the value is replaced — in place, in the event — by a
marker string:

```
<truncated:{first maxArgLength characters of the JSON}...>
```

Nothing is written anywhere else. The truncated content is gone, deliberately:
the trace stays a single self-contained JSONL file, which is the property every
consumer depends on.

Because the marker replaces the value rather than wrapping it, a truncated
argument changes type: an object or number becomes a string. Consumers must not
assume `args.foo` kept its original type.

The limit applies to `args` and `result` **independently, per value**, measured
on the JSON serialization rather than on the raw object.

## Configuration

| Runtime | Knob | Default |
|---------|------|---------|
| Java | `-Dflowtrace.max-arg-length`, or `FLOWTRACE_MAX_ARG_LENGTH` (the property wins) | 512 |
| Node / TypeScript | `FLOWTRACE_MAX_ARG_LENGTH` | 512 |
| Python | `FLOWTRACE_MAX_ARG_LENGTH` | 512 |
| Go | `FLOWTRACE_MAX_ARG_LENGTH` | 512 |
| Browser | — (no per-value truncation; it records URLs and error messages, not arbitrary arguments) | — |

`0` disables truncation entirely. An unparseable value falls back to the
default rather than erroring — a bad env var must not take down the traced
application.

`flowtrace run` also exports the limit from `.flowtrace/config.json`
(`capture.maxArgLength`), so it can be set once per project.

## Redaction runs before truncation

Every file-writing capture layer — **Java, Node/TypeScript, Python and Go** —
redacts values whose *name* matches a redact-key list, before the truncation
rule above ever sees them. A matching value is replaced in place with
`"<redacted>"`, at any nesting depth (not just top-level argument names), in
both `args` and `result`.

The built-in list — applied even when `FLOWTRACE_REDACT_KEYS` is unset — is:
`password,secret,token,authorization,api_key,url,dsn,connection_string,email`.

`FLOWTRACE_REDACT_KEYS` is a comma-separated list of ADDITIONAL substrings,
matched case-insensitively, appended to the built-in list — it does not
replace it. Java also accepts `-Dflowtrace.redact-keys`.

The browser layer applies the same list to its event args, with one deliberate
exemption: the URL-valued keys `url`, `from` and `to`, which are the point of a
browser span and are already stripped of query string and fragment. Path
segments there are recorded verbatim.

Why redaction is not optional: a trace is a file whose entire purpose is to be
read by an AI tool and pasted into a conversation. That is the last place a
credential should end up — and the Go layer shipped a fix in 3.3.0 for exactly
that, having serialized `Authorization` and `Cookie` headers out of every
traced HTTP handler.

## Parity across layers

`examples/golden/truncation/{java,node,python,go}` run the same scenario — a
long string value with the limit set to 64 — through each capture layer and
commit the real output. `make check-golden` diffs them.

**What that does and does not prove.** Each fixture is diffed against *its own
layer's* previous output, so it catches a regression within a layer. It cannot,
by construction, catch two layers disagreeing with each other — and they did:
Java emitted `…[truncated]` appended to the value while the other three emitted
`<truncated:…...>`, and measured the length of `toString()` rather than of the
JSON form. Only Go truncated results at all. Reading the four fixtures side by
side is what surfaced it.

So the fixtures are the regression net, not the parity check. The parity check
is this document plus a review that reads the layers together whenever the rule
changes. If the marker, the measurement basis, or the args/result symmetry
moves in one layer, it moves in all of them in the same commit.
