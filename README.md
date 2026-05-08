# FlowTrace

[🇺🇸 English](./README.en.md) | 🇪🇸 Español

Trazador de llamadas multi-lenguaje sin modificar el código fuente. Genera logs JSONL estructurados de cada método instrumentado, listos para análisis con IA.

**Runtimes soportados**: Java 11+ | Python 3.8+ | Node.js 18+ | TypeScript 5+

---

## Instalación rápida

```bash
npm install -g @flowtrace/cli
```

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

Los logs se escriben en `flowtrace.jsonl` en el directorio de trabajo.

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
| `trace.tree` | Arbol de llamadas de una traza |
| `trace.find_error` | Localiza la primera excepcion en el log |
| `trace.private_calls` | Lista metodos internos no expuestos en la API |
| `trace.diff` | Compara dos trazas (antes/despues de un cambio) |

```bash
npx @flowtrace/mcp-server
```

Configura tu IDE para apuntar a este servidor y los agentes de IA podran analizar los logs automaticamente.

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
