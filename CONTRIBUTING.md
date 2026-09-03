# Contributing to FlowTrace

Short, because the build tells you most of what you need. `make test` is the
source of truth: if it passes, CI passes.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

Prerequisites — all five toolchains, because `make test` exercises all five
capture layers:

| Tool | Version | Why |
|---|---|---|
| Node | ≥ 20.6 | `module.register()`; the whole JS workspace |
| pnpm | 9.15.4 (`corepack enable`) | one lockfile at the root; **not npm** |
| JDK | 21+ to build (bytecode target stays 11) | the java21 test sources need it |
| Maven | 3.9+ | the Java capture module |
| Python | ≥ 3.9 | the Python capture module |
| Go | ≥ 1.24 | `runtime/pprof` label layout — see `capture/go/README.md` |

The first Java run downloads the ~24 MB OpenTelemetry javaagent into
`~/.flowtrace/` and verifies it against a pinned SHA-256, so that step needs
network once.

```bash
pnpm install
make test
```

## What `make test` runs

```
validate-schema   every fixture against schema/flowtrace-v2.json
check-golden      re-runs every capture layer and diffs the committed output
test-java         JUnit, with -Dflowtrace.it.required=true so the integration
                  test cannot silently skip itself
test-python       pytest
test-node         node --test
test-go           go test ./...
test-browser      the browser layer plus a real collector end-to-end
test-mcp          the MCP server
test-dashboard    the dashboard API and analyzer
test-cli          the CLI
check-docs        the READMEs, the plugin command and the skill still restate
                  mcp-server/src/runtimes.ts
check-bundle      the committed bundles match their source, and the plugin
                  boots standalone
```

## The four things that will bite you

**1. Golden fixtures are real capture output.** `examples/golden/<id>/expected.jsonl`
is what the layer actually emitted, normalized and committed. If you change a
capture layer, `make check-golden` fails — that is the point. Regenerate with

```bash
node scripts/gen-golden.mjs <id>       # one fixture
make gen-golden                        # all of them
```

and then **read the diff**. Every changed line must be explained by the change
you made; a line you cannot explain is the finding. Add a new fixture by
registering it in `scripts/golden/runners.mjs` — CI picks it up from there.

A fixture cannot assert cross-process correlation: the normalizer rewrites
every `trace_id` to one constant. That property is tested by
`capture/node/test/test-cross-process.mjs`, which spawns real processes.

**2. Bundles are committed build artifacts.**

- Touched `mcp-server/src`? → `make bundle-mcp`
- Touched `flowtrace-dashboard/`? → `make bundle-dashboard`

Both are checked by `make check-bundle`, which rebuilds and fails on any diff.
A plugin install copies files and runs no build, so the bundle *is* the
product for anyone installing from the marketplace.

**3. `mcp-server/src/runtimes.ts` is the single source of truth** for what
FlowTrace supports. Change it first; the READMEs, the plugin command file and
the skill restate it, and `make check-docs` fails when they drift.

**4. The schema is a contract across five layers.** `schema/flowtrace-v2.json`
has `additionalProperties: false`. Renaming or adding a field means changing
every capture layer, the schema, every golden fixture and every consumer
(`mcp-server`, `flowtrace-dashboard`) **in one commit**. Two rules that have
each been broken before:

- A failed call is an `exit` with `error` set. There is no `event: "error"`.
- `result` is required on every exit — `{}` when there is no value.

## Commit messages

Conventional commits with a `Why:` body. The `Why:` is the part that matters:
it records the root cause or the decision, which the diff cannot.

```
fix: login redirect loop

Why: the stale refresh token was not cleared on 401, so /login and /dashboard
bounced between each other forever.
```

One logical change per commit. English, so the history reads consistently.

## Code style

There is no linter configured (see `ROADMAP.md`). Match the file you are in:
this codebase writes comments that explain *why*, especially where a previous
approach failed — several files record the exact silent failure they were
written to prevent. Keep that. A comment restating the code is noise; a comment
naming the trap is the reason the trap is not re-entered.

User-facing CLI text is Spanish (with accents). Code, comments and commit
messages are English.

## Layout

| Path | What |
|---|---|
| `capture/{java,node,python,go,browser}/` | the capture layers, one README each |
| `schema/flowtrace-v2.json` | the contract |
| `examples/golden/` | committed real capture output |
| `scripts/` | golden runners, schema validation, doc and plugin checks |
| `mcp-server/`, `flowtrace-dashboard/`, `flowtrace-cli/` | the consumers |
| `plugin/` | the distributable Claude Code plugin |
| `docs/` | architecture and dated change notes |

## Security

Please do not open a public issue for a vulnerability — see
[SECURITY.md](./SECURITY.md).
