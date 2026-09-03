# @flowtrace/capture-node

The Node.js / TypeScript capture layer of FlowTrace v2. It is **not published
on npm**: `@rixmerz/flowtrace` (the CLI) vendors this directory and injects it
into the process it launches, so `flowtrace run -- node app.js` is the
supported way to use it. The package name is a workspace-internal label.

## How it attaches

`src/bootstrap.mjs` is loaded with `node --import`. It

1. patches `Module.prototype._compile` (`src/cjs/hook.js`) for CommonJS,
2. registers `src/esm/loader.mjs` with `module.register()` for ES modules
   (Node 20.6+ — hence the floor),
3. seeds the trace from `FLOWTRACE_TRACEPARENT` and patches `fetch`,
   `http.request`, the HTTP server edge, `child_process` and
   `worker_threads.Worker` so context propagates in and out,
4. rewrites `NODE_OPTIONS` so every Node process this one starts loads the
   bootstrap too.

Every matched file is parsed with Babel (`src/transform/swc.js`; swc strips
TypeScript first) and each function body is wrapped in calls to
`__ft_enter` / `__ft_exit` / `__ft_exit_error` (`src/runtime/instrument.js`).
The rewritten source is cached under `~/.flowtrace/cache/node`, keyed by the
source, the transform's own source hash, and the Node/Babel versions.

Context propagation is `AsyncLocalStorage`, so `await` chains, timers and
promises keep their parent span.

## Knobs

| Variable | Meaning |
|---|---|
| `FLOWTRACE_OUTPUT` | Output path. Default `.flowtrace/<iso-timestamp>.jsonl` under cwd. |
| `FLOWTRACE_PACKAGE_PREFIX` | Only files whose path contains this string are instrumented. Unset: everything under cwd. `node_modules` is never instrumented. |
| `FLOWTRACE_MAX_ARG_LENGTH` | Per-value limit on the JSON form of each argument and of the result; `0` disables. Default 512. Over the limit the value becomes `<truncated:{first N chars}...>`. |
| `FLOWTRACE_REDACT_KEYS` | Extra key substrings to redact, comma-separated. Additive to the shared defaults (`password, secret, token, authorization, api_key, url, dsn, connection_string, email`); a matching arg name or nested object key is written as `<redacted>`. |
| `FLOWTRACE_TRACEPARENT` | A W3C `traceparent` to adopt at startup, set by whatever spawned this process. |
| `FLOWTRACE_PROPAGATE=0` | Turn off outbound propagation (fetch/http headers, child process and worker environments). |

## What the events look like

- `lang` is `node` for `.js/.cjs/.mjs` sources and `ts` for
  `.ts/.tsx/.mts/.cts` sources.
- `thread` is `main` on the main thread and `worker-<threadId>` inside a
  `worker_threads` Worker. A Worker created inside a span joins that span's
  trace (its environment carries the `traceparent`).
- `module` is the file's basename without extension; `class` is the class
  name or `""` for plain functions.
- `visibility` is `private` for `#private` and TypeScript `private` methods,
  `public` otherwise.
- `args` keys are the parameter names. A destructured parameter is recorded
  under `argN` with the whole destructured value.
- `result` is `{"value": X}`, or `{}` for `undefined`/`null` and for a call
  that threw (then `error` is set).

## What is deliberately not instrumented

- Functions nested inside an instrumented function (callbacks, closures):
  every `.map(x => …)` would otherwise become a span and an Express app's
  trace would be unreadable. Top-level functions, class methods, object-literal
  methods and arrows assigned to a binding are instrumented.
- Generators and async generators.
- Constructors.
- Getters and setters.

## Tests

```bash
make test-node                     # node --test test/*.mjs
node --test test/test-transform-params.mjs
```

The cross-process and worker-thread tests spawn real processes; a golden
fixture cannot assert id correlation because the normalizer rewrites every
`trace_id` to one constant.
