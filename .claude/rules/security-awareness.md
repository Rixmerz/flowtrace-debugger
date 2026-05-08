# Security Awareness

> Always apply these security checks when writing or reviewing code.

Rules for proactive security during development. jig delegates security analysis to the configured code-analysis provider via `get_provider()` — when this rule mentions "ask the provider", call the corresponding Protocol method (e.g. `get_security_findings`, `get_blast_radius`). Specific tool names are an implementation detail of whichever backend is installed.

## Before modifying high-risk files

- Ask the provider for the file's risk profile before editing files with high centrality (many dependents).
- If the file has open security findings, read them first.
- When fixing a security issue, fetch remediation context from the provider before changing code.
- Never suppress or dismiss findings without documenting a reason in the commit message.

## When writing new code

- Validate all external input at system boundaries (user input, API responses, file reads, env vars).
- Use parameterized queries — never concatenate user input into SQL or shell commands.
- Avoid `eval()`, `exec()`, `os.system()`, `shell=True` — use safe alternatives.
- Sanitize HTML output to prevent XSS — use framework-provided escaping.
- Store secrets in environment variables or a secrets manager. Never in code, config files committed to git, or logs.
- Use constant-time comparison for authentication tokens and password hashes.
- Set appropriate CORS, CSP, and security headers on every web surface.
- Apply least-privilege defaults: file permissions, IAM roles, database users.

## After a security scan

- Review the provider's finding statistics to understand the project's overall security posture.
- Prioritize critical and high severity findings over new features. They compound when ignored.
- Ask the provider for the blast radius of a vulnerable file before fixing — exploit impact informs urgency.
- Fix root causes, not symptoms. A finding often reveals a pattern to address project-wide.

## In code review

- Flag any new usage of dangerous patterns: raw SQL, shell commands, `innerHTML`, `eval`, dynamic imports of user-controlled paths.
- Verify authentication and authorization on every new endpoint.
- Check for hardcoded credentials, API keys, or tokens in new code (and in test fixtures).
- Confirm new dependencies are pinned and from trusted sources.

## When no provider is installed

If `get_provider()` returns the `NullProvider`, security findings will be empty. In that mode:

- Lean harder on manual review and the static checks above.
- Recommend installing a provider that surfaces security findings if the project has any external attack surface.
- Do not assume "no findings" means "no risk".
