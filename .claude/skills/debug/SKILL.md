---
name: debug
description: Debugging universal. Tests, FlowTrace, profiling, estrategias hibridas. Clasifica el bug y selecciona la estrategia optima.
user-invocable: true
argument-hint: "[help|debug|profile|test|status|clean]"
---

# Debug

Framework de debugging universal multi-estrategia. Clasifica el tipo de bug y selecciona la herramienta optima: tests, FlowTrace, profiling, o combinaciones.

## Subcomandos

Parsea `$ARGUMENTS` para determinar la accion:

- **vacio o "help"** -> Mostrar herramientas disponibles (nativas + FlowTrace)
- **"debug [path]"** -> Ciclo completo de debugging con workflow graph
- **"profile [path]"** -> Analisis de performance (FlowTrace o nativo)
- **"test [path] [filter]"** -> Detectar test framework y ejecutar tests
- **"status [path]"** -> Estado de FlowTrace en el proyecto (si aplica)
- **"clean [path]"** -> Limpiar logs de FlowTrace

## Ejecucion

### Para help (default):

Muestra las herramientas organizadas:

```
Universal Debugger - Multi-Strategy

NATIVAS (siempre disponibles):
  Read, Glob, Grep    — Leer y buscar codigo fuente
  Bash                 — Ejecutar tests, profilers, build tools
  Write, Edit          — Modificar codigo (solo en fase fix)

TEST FRAMEWORKS (auto-detectados):
  cargo test           — Rust (Cargo.toml)
  npm test / vitest    — Node.js (package.json)
  go test              — Go (go.mod)
  pytest               — Python (pyproject.toml)
  dotnet test          — .NET (*.csproj)
  rspec / rake test    — Ruby (Gemfile)

FLOWTRACE MCP (cuando disponible):
  AUTOMATIZACION:
    flowtrace.detect    — Detectar lenguaje y framework
    flowtrace.init      — Inicializar FlowTrace en proyecto
    flowtrace.build     — Compilar proyecto
    flowtrace.execute   — Ejecutar con instrumentacion
    flowtrace.cleanup   — Limpiar logs
    flowtrace.status    — Estado del proyecto

  ANALISIS DE LOGS:
    log.open            — Cargar JSONL, obtener sessionId
    log.schema          — Descubrir campos y fila de ejemplo
    log.search          — Filtrar filas por substring
    log.timeline        — Eventos cronologicos
    log.sample          — Muestras representativas
    log.topK            — Top N valores de un campo
    log.aggregate       — Agrupar y calcular count/sum/avg/max/min
    log.flow            — Correlacionar eventos por claves compuestas
    log.errors          — Auto-detectar patrones de error
    log.export          — Exportar a CSV/JSON
    log.expand          — Recuperar datos completos de entradas truncadas
    log.searchExpanded  — Buscar con auto-expansion

  DASHBOARD DE PERFORMANCE:
    dashboard.open       — Analizar archivo + URL de dashboard
    dashboard.analyze    — Metricas JSON de performance
    dashboard.bottlenecks— Top N por score de impacto
    dashboard.errors     — Hotspots de errores

ESTRATEGIAS POR TIPO DE BUG:
  Serializacion/Data   — Roundtrip tests, schema validation
  Logica/Flujo         — Unit tests + assertions
  Performance          — FlowTrace profiling o profilers nativos
  Concurrencia         — Stress tests + sanitizers + FlowTrace timeline
  Integracion          — FlowTrace + request replay
  Memoria              — Heap profiling + sanitizers
```

### Para debug [path]:

Activa el workflow graph para debugging estructurado:

```
graph_activate("debug-graph")
```

El workflow guia paso a paso:
1. Entender el problema (read-only + tests)
2. Reproducir el bug ejecutando tests
3. Clasificar tipo de bug y seleccionar estrategia
4. Observar con la estrategia seleccionada (tests / FlowTrace / hibrido)
5. Analizar datos recopilados
6. Formar hipotesis con evidencia
7. Implementar fix quirurgico
8. Verificar fix con tests + opcionalmente FlowTrace
9. Reportar

### Para profile [path]:

Analisis enfocado en performance:

1. Detectar stack tecnologico del proyecto
2. Si FlowTrace disponible y lenguaje soportado:
   - `flowtrace.status` -> verificar que hay logs
   - Si no hay logs: ejecutar setup + execute primero
   - `dashboard.analyze` con path al jsonl -> metricas completas
   - `dashboard.bottlenecks` top 10 -> metodos con mayor impacto
   - `dashboard.errors` -> hotspots de errores
   - `log.aggregate` por clase/metodo, metric avg durationMillis -> desglose
   - `log.topK` byField durationMillis, k=20 -> outliers
3. Si FlowTrace no disponible o lenguaje no soportado:
   - Rust: `cargo bench`, `flamegraph`, `criterion`
   - Node.js: `--prof`, `clinic.js`, `0x`
   - Python: `cProfile`, `py-spy`
   - Go: `pprof`, `go test -bench`
4. Presentar reporte de performance con recomendaciones

### Para test [path] [filter]:

Detecta test framework y ejecuta tests:

1. Detectar stack:
   - `Cargo.toml` -> `cargo test [filter]`
   - `package.json` -> buscar script "test", o `npx vitest run [filter]`, o `npx jest [filter]`
   - `go.mod` -> `go test ./... -run [filter]`
   - `pyproject.toml` -> `pytest [path] -k [filter]`
   - `*.csproj` -> `dotnet test --filter [filter]`
2. Ejecutar con Bash
3. Parsear output: tests pasados, fallidos, errores
4. Si hay fallos, mostrar detalle de cada test fallido
5. Sugerir siguiente paso: `debug` si hay fallos complejos

### Para status [path]:

1. `flowtrace.status` con projectPath (si FlowTrace disponible)
2. Reportar: inicializado?, config, tamano de logs, logs truncados
3. Si FlowTrace no disponible, reportar: "FlowTrace MCP no conectado. Usa testing nativo."

### Para clean [path]:

1. `flowtrace.cleanup` con projectPath (si FlowTrace disponible)
2. Reportar: archivos eliminados, bytes liberados

## Acceso a FlowTrace

FlowTrace NO es un MCP directo del agente. Se accede a traves del proxy `execute_mcp_tool` del jig:

```
execute_mcp_tool(
  mcp_name="flowtrace",
  tool_name="flowtrace_detect",
  arguments={"projectPath": "/path/to/project"}
)
```

Los nombres de tools usan underscores: `flowtrace_detect`, `flowtrace_init`, `log_open`, `log_search`, `dashboard_bottlenecks`, etc.

## Notas

- FlowTrace es OPCIONAL. El debugger funciona sin ningun MCP conectado.
- Para proyectos sin FlowTrace, el debugging se basa en: tests, Bash, Read/Grep.
- El MCP server de FlowTrace es opcional; si el usuario lo tiene, la ruta al servidor es local a su entorno (no asumir rutas absolutas de otra máquina).
- FlowTrace soporta: Node.js, Java, Python, Go, Rust, .NET
- Para lenguajes no soportados por FlowTrace: usa tests nativos y profilers
- Las trazas FlowTrace se generan en `flowtrace.jsonl` en el directorio del proyecto
- Siempre limpiar logs entre iteraciones para trazas limpias
