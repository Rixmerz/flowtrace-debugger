---
name: jig-methodology
description: Playbook operativo para trabajar dentro de un proyecto scaffoldeado con jig — cómo descubrir tools, cuándo usar proxies internos, cómo leer la telemetría de snapshots+DCC, y qué NO hacer a mano. Consultar antes de sesiones complejas o cuando el agente se siente tentado a shell-out en vez de usar un tool nativo.
---

# jig Methodology

Complementa la rule `jig-methodology.md` con un flujo concreto. La rule
dice el qué; este skill da el cómo y los patrones.

## Cuándo invocar este skill

- Sesión nueva en un proyecto jig → lee el apartado "Kickoff".
- Acción no trivial (refactor, migración, debug profundo) → "Flujo
  estándar por tipo de tarea".
- Vas a `git log`, `git status`, `grep commit messages` → corta y
  leé "Reemplazos nativos".
- Sentís que estás peleando con el enforcer → "Enforcer y phase gates".

## Kickoff (primeros 30 segundos de una sesión)

```
1. jig_guide(topic="getting-started")              # contexto narrado
2. graph_list_available(project_dir=…)             # ¿hay workflows?
3. graph_status(project_dir=…)                     # ¿workflow activo?
4. experience_stats(project_dir=…)                 # ¿hay memoria previa?
5. project_metadata_get(project_dir=…)             # tech stack detectada
```

Si `graph_status` reporta un workflow activo, estás dentro de phase
enforcement. Respetá los blocks. Si no hay, seguís libre pero las
hooks siguen capturando snapshots automáticos.

## Flujo estándar por tipo de tarea

### Feature nuevo (creative coding)

1. `experience_query(project_dir=…, file_pattern="…")` — ¿resolviste
   algo parecido antes?
2. (opcional) `graph_activate(graph_id="demo-feature")` — fuerza el
   ciclo understand → design → implement → verify.
3. Implementación: Edit/Write normales. Snapshots y DCC deltas salen
   solos.
4. `experience_record(...)` solo si te das cuenta de un patrón
   reutilizable que el hook no capturó.

### Bug hunt

1. `graph_timeline(limit=30)` — transiciones + DCC tensions + git
   commits correlacionados. El bug suele aparecer en un delta de
   tensión cerca de un commit.
2. Si hay smells en la zona, `execute_mcp_tool("graph",
   "graph_mid_phase_dcc", {...})` da el análisis crudo.
3. Fix + test. El snapshot trigger captura el antes/después.

### Refactor de superficie grande

1. `pattern_catalog_get(path="…")` — ¿el catálogo ya conoce este
   patrón? No dupliques.
2. `execute_mcp_tool("metadata", "project_metadata_refresh", {...})`
   antes de empezar si cambia la forma del proyecto (nuevos bounded
   contexts, migraciones).
3. Avanzá en commits chicos. Los snapshots automáticos ya son tu
   safety net — no hace falta manual `git stash`.

### Agregar un MCP al proyecto

```
proxy_add(name="…", command="…", args=[…])
```

El warmup embebe las descripciones; a partir de ahí, cada vez que
necesites algo del MCP nuevo:

```
proxy_tools_search(query="…", proxy="…")       # opcional filter
execute_mcp_tool(mcp_name="…", tool_name="…", arguments={…})
```

## Reemplazos nativos (no shell-out)

| En vez de | Usá |
|-----------|-----|
| `git log --oneline` | `graph_timeline` |
| `git stash && git checkout` | `execute_mcp_tool("snapshot", "snapshot_restore", {"snap_id": "…"})` |
| `grep` en commits viejos | `experience_query` |
| Re-escanear `package.json` / `Cargo.toml` | `project_metadata_get(section="tech_stack")` |
| "¿cómo era el patrón de migrations?" | `project_metadata_get(section="migration_number")` |
| Abrir una issue para recordar | `experience_record(type="…", description="…")` |

## Enforcer y phase gates

Cuando un hook bloquea una tool call:

1. Leé el mensaje completo. El enforcer te dice qué falta.
2. Si falta traversar una phase, `graph_traverse(direction="next")`
   DESPUÉS de cumplir la condición (no antes).
3. Si hay una `tension_gate` fallando, atendé las smells listadas
   antes de avanzar. `execute_mcp_tool("graph",
   "graph_acknowledge_tensions", {...})` solo cuando las revisaste y
   decidiste aceptarlas conscientemente — queda en audit log.
4. No intentes saltarte con Bash. El enforcer también mira Bash.

## Qué NO hacer

- No crees snapshots manuales. El hook lo hace cada 30 s.
- No escribas `.mcp.json` a mano — usá `proxy_add` / `jig_init_project`.
- No asumas que un tool archivado no existe; primero probá
  `proxy_tools_search`. 30+ ops viven así.
- No ignores el `additionalContext` que inyecta el snapshot hook. Si
  te lista "DCC smells in changed files: [high] god_file", pausá
  antes del siguiente edit.
- No duplicar lógica del `project_metadata` ya auto-descubierto.
