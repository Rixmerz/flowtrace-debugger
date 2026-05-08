# Golden fixture — Python

Minimal Python sample and the trace it MUST produce when run under
`flowtrace run -- python calculator.py` (Sprint 3 deliverable).

## App

`calculator.py` — three methods, no FlowTrace imports/decorators.

## Call tree

```
run() [public]
  add(2, 3) [public]
    _validate(2) [private (underscore convention)]
    _validate(3) [private]
```

`_validate` is name-mangled-style private (PEP 8 leading underscore).
The Python capture (Sprint 3, `importlib` MetaPathFinder + AST rewrite)
infers `visibility: private` from the leading underscore.

`expected.jsonl` is the spec the Sprint 3 capture must match
(modulo `ts`, `span_id`, `duration_ns`).
