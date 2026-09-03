# Golden fixture — truncation (Go)

The Go half of the truncation parity set (`examples/golden/truncation/{java,node,python,go}`,
see `TRUNCATION_SYSTEM.md`). Run by `scripts/golden/runners.mjs` through the real
`cmd/flowtrace-go` driver with `FLOWTRACE_MAX_ARG_LENGTH=64`.

## What it asserts

`main()` calls `generate(1000)`, which returns a 1000-character string, then
`process(<that string>)`, which returns the short `processed:1000`.

- `process`'s `args.data` is replaced — on its `enter` **and** its `exit`, the
  same way the Node/Python fixtures do — by the marker
  `<truncated:"xxx…>`: the first 64 characters of the value's **JSON** form
  (the opening quote counts, so 63 `x`), then `...>`.
- `generate`'s `result.r0` is truncated by the identical rule: the limit
  applies to `args` and `result` independently, per value. The result key is
  positional (`r0`) because `generate` does not name its result.
- `process`'s short result and `generate`'s integer argument (`n: 1000`) are
  left verbatim — only values whose JSON form exceeds the limit change.

`main` gets its own span at depth 0 because Go needs a `main()` function
(see `examples/golden/go/README.md`), so the tree is one level deeper than
the Node fixture and identical in shape to the Python one.

`expected.jsonl` is real capture output normalized by
`scripts/golden/normalize.mjs` (`ts`, ids, `duration_ns` and the numeric part
of `goroutine-<n>` are canonicalized; everything else is compared verbatim).
