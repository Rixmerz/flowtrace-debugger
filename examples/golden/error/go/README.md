# Golden fixture — error path (Go)

The Go member of `examples/golden/error/{java,node,python,go}`: the fixtures
that pin what a **failed call** looks like in the v2 schema. Run by
`scripts/golden/runners.mjs` through the real `cmd/flowtrace-go` driver.

## Call tree

```
main()                      depth 0 — exits clean: both failures are handled here
  outer(7)                  depth 1 — exit carries error (propagated, unchanged)
    inner(7)                depth 2 — exit carries error (returned non-nil error)
  shield(7)                 depth 1 — exit carries error (its own named `err` result)
    explode(7)              depth 2 — exit carries error (panic, recovered by shield)
```

## What it asserts

- **A failed call is an `exit` with `error` set** — never a separate event.
  `result` stays present on that branch: `{"r0": {}}` for `inner`/`outer`
  (an `*errors.errorString` has only unexported fields, so it serializes to
  `{}`), `{}` for the panicking `explode`, and `{"result": 0, "err": {}}` for
  `shield`.
- **A returned error propagates through every frame that returns it.**
  `outer` never inspects the error, yet its exit carries it too — an agent
  that only tagged the frame where the error was created would fail here.
- **A panic is captured where it happened, not where it was recovered.**
  `explode`'s exit has `error.type: "string"` with a non-empty stack
  (normalized to `["<scrubbed>"]`); `shield`'s exit has the returned error
  with an empty stack, because a returned error has no stack of its own.
- **Named results keep their declared names.** `shield` declares
  `(result int, err error)`, so its `result` object is keyed `result`/`err`;
  the unnamed `error` of `inner`/`outer` is keyed positionally as `r0`.

`expected.jsonl` is real capture output normalized by
`scripts/golden/normalize.mjs` (`ts`, ids, `duration_ns`, stack frames and
the numeric part of `goroutine-<n>` are canonicalized; everything else is
compared verbatim).
