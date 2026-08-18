# Truncation

How FlowTrace v2 keeps a single oversized argument or return value from
dominating a trace.

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

## Configuration

| Runtime | Knob | Default |
|---------|------|---------|
| Java | `-Dflowtrace.max-arg-length` | 512 |
| Node / TypeScript | `FLOWTRACE_MAX_ARG_LENGTH` | 512 |
| Python | `FLOWTRACE_MAX_ARG_LENGTH` | 512 |

`0` disables truncation entirely. An unparseable value falls back to the
default rather than erroring — a bad env var must not take down the traced
application.

The limit applies to `args` and `result` independently, per value, measured on
the JSON serialization rather than on the raw object.

## Parity is pinned by fixtures

`examples/golden/truncation/{java,node,python}` run the same scenario — a
1000-character string argument with the limit set to 64 — through all three
capture layers and commit the real output. `make check-golden` diffs them, so a
change to one runtime's truncation that is not mirrored in the others fails CI.
That is the only thing keeping the three implementations honest with each
other; there is no shared code between them.
