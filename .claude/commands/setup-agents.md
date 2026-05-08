---
name: setup-agents
description: Detect this project's tech stack and deploy specialized subagents and skills. Run after jig init, after updating jig, or when the tech stack changes.
disable-model-invocation: true
argument-hint: "[tech-stack]"
---

Detect this project's tech stack and deploy specialized subagents.

**When to run:**
- After `jig init` on a new or re-scaffolded project
- After updating jig to a new version (agents and skills may have changed)
- When the project's tech stack changes (e.g. adding a frontend to a backend project)

1. Analyze the project to identify languages and frameworks:
   - Check file extensions in the project root and src/ directories
   - Read package.json, Cargo.toml, go.mod, pyproject.toml, etc. if they exist
   - Identify the primary languages (e.g., typescript, python, rust, go)
   - Identify frameworks (e.g., react, tauri, fastapi, gin, fastmcp)

2. Call the `deploy_project_agents` MCP tool:
   ```
   deploy_project_agents(
     project_path: "<current project path>",
     tech_stack: ["<detected languages and frameworks>"],
     include_core: true
   )
   ```

3. Report what was deployed:
   - List the agents created in `.claude/agents/`
   - List the skills assigned to each agent
   - Confirm the agents are ready to use

If `deploy_project_agents` is not available (jig MCP not connected), explain that the user needs to reconnect jig via `/mcp` first.
