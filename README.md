# FlowTrace

[🇺🇸 English](./README.en.md) | 🇪🇸 Español

Trazador de llamadas multi-lenguaje sin modificar el código fuente. Genera logs JSONL estructurados de cada método instrumentado, listos para análisis con IA.

**Runtimes soportados**: Java 11+ | Python 3.8+ | Node.js 20.6+ | TypeScript 5+ | Go 1.24+

La lista de arriba es la única fuente de verdad sobre qué runtimes soporta
FlowTrace. El servidor MCP la expone como el recurso `flowtrace://runtimes`,
así que un agente puede consultarla en vez de deducirla.

---

## Instalación rápida

```bash
npm install -g @rixmerz/flowtrace
```

O sin instalar nada:

```bash
npx @rixmerz/flowtrace run -- python miapp.py
```

`@rixmerz/flowtrace` es el **único** paquete publicado. Trae dentro las capas
de captura de los cinco runtimes: no hace falta Maven, ni pip, ni instalar
`@flowtrace/capture-node` (ese nombre no existe en npm — es un paquete interno
del workspace, y la CLI ya lo lleva vendorizado).

---

## Quickstart

### Java
```bash
flowtrace run -- java -jar miapp.jar
```

### Python
```bash
flowtrace run -- python miapp.py
```

### Node.js / TypeScript
```bash
flowtrace run -- node miapp.js
# o con ts-node:
flowtrace run -- ts-node miapp.ts
```

### Go
```bash
flowtrace run -- go run ./cmd/api
# tambien funcionan `go build` y `go test`
```
Requiere Go 1.24+. La instrumentacion ocurre antes de compilar (via `go build
-overlay`): tu arbol de fuentes no se modifica, ni un byte.

### Dónde queda la traza

`flowtrace run` escribe en `.flowtrace/<timestamp>.jsonl` dentro del directorio
de trabajo, y añade `.flowtrace/` al `.gitignore` del proyecto. Lo imprime al
arrancar. El nombre `flowtrace.jsonl` es el default sólo cuando cableas una
capa de captura a mano; toda herramienta acepta una ruta explícita.

---

## Tracing distribuido (multi-proceso)

Los ids son compatibles con W3C Trace Context, así que una traza sobrevive a un
salto entre procesos: un servicio propaga `traceparent` y el siguiente lo
adopta en vez de empezar una traza nueva. Ambas mitades quedan bajo un mismo
`trace_id`, consultable como un solo árbol.

| Runtime | Entrante (adopta la traza del llamador) | Saliente (propaga a la siguiente) |
|---|---|---|
| Node / TS | Automático — header HTTP y `FLOWTRACE_TRACEPARENT` | **Automático** — parcha `fetch` y `http.request` |
| Python | Automático — header HTTP y `FLOWTRACE_TRACEPARENT` | Manual |
| Java | Automático — el agente OTel propaga en los frameworks que instrumenta, más `FLOWTRACE_TRACEPARENT` | Automático dentro de lo que instrumenta OTel |
| Go | Automático vía `FLOWTRACE_TRACEPARENT`; en el handler, `flowtracert.SeedFromTraceparent(r.Header.Get("traceparent"))` | Manual — `flowtracert.CurrentTraceparent()` |

Go no propaga solo porque no hay dónde engancharse: `net/http` se resuelve en
tiempo de compilación y parcharlo obligaría a reescribir llamadas al stdlib
dentro del overlay. Se adjunta a mano:

```go
req, _ := http.NewRequest("GET", url, nil)
if tp := flowtracert.CurrentTraceparent(); tp != "" {
    req.Header.Set("traceparent", tp)
}
```

Para encadenar procesos sin HTTP de por medio, exporta `FLOWTRACE_TRACEPARENT`
antes de lanzar el hijo: los cuatro runtimes lo leen.

---

## Schema de salida (JSONL v2)

Cada línea es un objeto JSON. Ver [docs/architecture.md](docs/architecture.md#schema-v2) para la especificación completa.

```json
{"ts":1715000000.123,"event":"enter","lang":"python","class":"OrderService","method":"create","trace_id":"abc","span_id":"def","parent_id":null,"depth":0}
{"ts":1715000000.456,"event":"exit","lang":"python","class":"OrderService","method":"create","result":{"id":42},"duration_ns":333000,"depth":0}
```

---

## Integración con IA (MCP server)

El servidor MCP expone herramientas para que agentes de IA analicen trazas directamente:

| Herramienta | Descripcion |
|---|---|
| `trace_tree` | Arbol de llamadas de una traza |
| `trace_find_error` | Localiza la primera excepcion en el log |
| `trace_private_calls` | Lista metodos internos no expuestos en la API |
| `trace_diff` | Compara dos trazas (antes/despues de un cambio) |

Además expone el recurso `flowtrace://runtimes`: runtimes soportados, versión
mínima, cómo se invoca cada uno y qué propagación tiene. Un agente lo lee en
vez de inferir capacidades de un README.

La forma soportada de correrlo es el plugin de Claude Code, que lo trae como un
bundle de un solo archivo:

```
/plugin marketplace add Rixmerz/flowtrace-debugger
/plugin install flowtrace@rixmerz-flowtrace
```

El plugin también deja `flowtrace` en el PATH, así que `flowtrace run -- ...`
funciona sin instalación global.

---

## Dashboard

```bash
cd flowtrace-dashboard && npm start
# http://localhost:3000
```

Ver [flowtrace-dashboard/](flowtrace-dashboard/) para instrucciones completas.

---

## Migracion desde v1

Si usas logs v1 (`ENTER`/`EXIT`, `durationMicros`), consulta:

[docs/migration-v1-v2.md](docs/migration-v1-v2.md)

---

## Licencia

MIT — ver [LICENSE](LICENSE)
