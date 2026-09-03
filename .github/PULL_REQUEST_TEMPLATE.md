# Pull Request

## What changed and why

<!-- The "why" is the part the diff cannot show: the root cause, or the
     decision and what it rules out. -->

Fixes # (issue)

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change (schema, CLI flags, or an emitted field)
- [ ] Documentation
- [ ] Refactor
- [ ] Performance
- [ ] Tests

## Component

- [ ] Java capture layer
- [ ] Python capture layer
- [ ] Node.js / TypeScript capture layer
- [ ] Go capture layer
- [ ] Browser capture layer
- [ ] CLI (`@rixmerz/flowtrace`)
- [ ] MCP server
- [ ] Dashboard
- [ ] Claude Code plugin
- [ ] Schema / golden fixtures
- [ ] Documentation
- [ ] Build / CI

## Checks

- [ ] `make test` passes locally
- [ ] Touched a capture layer → regenerated the golden fixtures and **reviewed
      the diff**; every changed line is explained by this change
- [ ] Touched `mcp-server/src` → ran `make bundle-mcp` and committed the bundle
- [ ] Touched `flowtrace-dashboard/` → ran `make bundle-dashboard` and committed it
- [ ] Touched `mcp-server/src/runtimes.ts` → the READMEs, `plugin/commands/trace.md`
      and the skill still agree (`make check-docs`)
- [ ] Changed an emitted field → the schema, all five capture layers, the
      fixtures and both consumers move in this commit
- [ ] Added tests for the behaviour this changes

**Tested on**: OS, and the runtime versions relevant to the change (Node, JDK,
Python, Go).

## Notes

<!-- Anything a reviewer would otherwise have to reconstruct: an approach you
     tried and rejected, a limitation you left in place on purpose. -->
