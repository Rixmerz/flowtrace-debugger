# Golden fixture — Express

Proves the Node capture traces user code running inside a real framework
request cycle, not just a script called directly from `main`.

## App

- `app.js` — the traced unit: an Express route handler and the two functions
  it calls. No FlowTrace imports or decorators.
- `run.js` — harness: boots on an ephemeral port, issues one `GET /orders/7`,
  shuts down, then calls `process.exit(0)`.

`run.js` sits outside the instrumented prefix
(`FLOWTRACE_PACKAGE_PREFIX=app.js`), so neither the harness nor Express's own
internals appear in the trace and the event sequence stays deterministic.

## Call tree

```
buildApp() [public]
handleGetOrder(req, res) [public]
  loadOrder(7) [public]
    _rate(700) [private — underscore convention]
```

8 events: 4 enter / 4 exit.

## Why the harness calls process.exit()

Deliberately. A server shutting down that way is ordinary, and it used to
truncate the trace: the emitter queued asynchronous writes and only settled
them on `beforeExit`, which `process.exit()` never fires. This fixture emitted
**1 of 8 events** before that was fixed — the whole request cycle was missing,
with no error. See `capture/node/test/test-emitter-exit.mjs`.

`expected.jsonl` is the spec this capture must match (modulo `ts`, `span_id`,
`duration_ns` — see `scripts/golden/normalize.mjs`).
