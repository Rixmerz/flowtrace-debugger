# Golden fixture — TypeScript

Minimal TS sample and the trace it MUST produce when run under
`flowtrace run -- tsx calculator.ts` (Sprint 4 deliverable).

## App

`calculator.ts` — three methods. Uses JS-native `#` private fields
(no `private` TS keyword needed; `#` is the runtime-enforced form).
No FlowTrace imports/decorators. No `tsconfig` change required.

## Call tree

```
run() [public]
  add(2, 3) [public]
    #validate(2) [private]
    #validate(3) [private]
```

The TS capture shares the Node Sprint 4 path: `Module._compile` /
ESM loader hooks + swc TypeScript preset. swc strips types and
preserves `#` privacy semantics.

`expected.jsonl` is the spec the Sprint 4 capture must match
(modulo `ts`, `span_id`, `duration_ns`).
