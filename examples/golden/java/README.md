# Golden fixture — Java

Minimal Java sample app and the trace it MUST produce when run under
`flowtrace run -- java -jar app.jar` (Sprint 2 deliverable).

## App

`Calculator.java` — three methods, no FlowTrace imports/annotations.

## Call tree

```
run() [public]
  add(2, 3) [public]
    validate(2) [private]
    validate(3) [private)
```

## Expected trace

`expected.jsonl` — 8 events: 4 enter / 4 exit, fully nested with
W3C trace context. `validate` is `visibility: private` — capturing
private methods is a hard requirement for v2 (point of the OTel-Java
extension over the v1 ByteBuddy custom agent).

This file is the spec the Sprint 2 capture must match (modulo
`ts`, `span_id`, and `duration_ns` values).
