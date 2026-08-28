# Golden fixture — Go

Minimal Go module and the trace it MUST produce when run under
`flowtrace run --lang go -- go run .` (the Go capture layer's AC1/AC6
deliverable).

## App

`calculator.go` — a struct method, a private helper method, and the `main`
entrypoint. No FlowTrace imports, no build tags: zero source modification is
the v2 contract (D1 — instrumentation happens entirely through a `go build
-overlay`, never by writing into this tree).

It also exercises the three other shapes AC1 lists as required: a returned
non-nil `error` (`Divide`), a panic recovered upstream (`SafeDivide`), and a
spawned goroutine whose span is parented under the spawning function
(`spawnAdd`).

## Call tree

```
main() [private — package-level func, lowercase]
  (*Calculator).Run() [public]
    (*Calculator).Add(2, 3) [public]
      (*Calculator).validate(2) [private — lowercase method name]
      (*Calculator).validate(3) [private]
  (*Calculator).Divide(1, 0) [public — returns (0, error), no panic]
  (*Calculator).SafeDivide(10, -1) [public]
    (*Calculator).validate(-1) [private — panics; ExitPanic fires and
      re-panics per D4, but SafeDivide's own recover stops it before main]
  (*Calculator).spawnAdd(4, 5) [private]
    (*Calculator).Add(4, 5) [public — runs on a SPAWNED goroutine; parent_id
      is spawnAdd's span_id, same trace_id, per D3]
      (*Calculator).validate(4) [private]
      (*Calculator).validate(5) [private]
```

Go requires a `main()` entrypoint function, unlike Python's
`if __name__ == "__main__":` block or Node's top-level script body, so it
gets its own span (depth 0) — one level deeper than the Python/Node
calculator fixtures, which start at `run()`/depth 0. That is an inherent
difference in language shape, not a capture bug.

`spawnAdd` blocks on a `sync.WaitGroup` until its spawned goroutine's `Add`
call has both entered and exited, so the event order is fully deterministic
despite the real concurrency — no test-only synchronization primitive is
injected into the fixture beyond what a normal Go program would use.

`expected.jsonl` is the spec the Go capture must match (modulo `ts`,
`span_id`, `duration_ns`, and — Go-specific — the numeric part of a
`goroutine-<id>` `thread` value, which is a runtime-internal id that varies
run to run; see `scripts/golden/normalize.mjs`'s header comment. The
*shape* — the spawned call gets a thread different from its parent's — is
still fully asserted, just renumbered in order of first appearance the same
way `span_id` already is.)
