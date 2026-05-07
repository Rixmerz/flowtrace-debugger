# Golden fixture — Node (CJS)

Minimal Node CJS sample and the trace it MUST produce when run under
`flowtrace run -- node calculator.js` (Sprint 4 deliverable).

## App

`calculator.js` — three methods on a class. Uses ES2022 private class
fields (`#validate`). No FlowTrace imports/decorators.

## Call tree

```
run() [public]
  add(2, 3) [public]
    #validate(2) [private — # field syntax]
    #validate(3) [private]
```

The Node capture (Sprint 4, `Module._compile` hook + swc transform)
detects `#`-prefixed methods and emits `visibility: private`.

`expected.jsonl` is the spec the Sprint 4 capture must match
(modulo `ts`, `span_id`, `duration_ns`).
