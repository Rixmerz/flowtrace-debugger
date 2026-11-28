# FlowTrace

[![v2-ci](https://github.com/Rixmerz/flowtrace-debugger/actions/workflows/v2-ci.yml/badge.svg)](https://github.com/Rixmerz/flowtrace-debugger/actions/workflows/v2-ci.yml)
[![npm](https://img.shields.io/npm/v/@rixmerz/flowtrace)](https://www.npmjs.com/package/@rixmerz/flowtrace)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[🇺🇸 English](./README.en.md) | 🇪🇸 Español

Trazador de llamadas multi-lenguaje sin modificar el código fuente. Genera logs JSONL estructurados de cada método instrumentado, listos para análisis con IA.

**Runtimes soportados**: Java 11+ | Python 3.9+ | Node.js 20.6+ | TypeScript 5+ | Go 1.24+ | Rust 1.81+

Más el **navegador**, que es una capa aparte y más angosta: sin
`AsyncLocalStorage` no hay contexto asíncrono ambiente, así que no instrumenta
cada función — registra HTTP, navegación y errores.

```bash
npm i @rixmerz/flowtrace-browser        # sólo el navegador; el resto va en el CLI
```

El recurso `flowtrace://runtimes` del servidor MCP es la fuente de verdad sobre
qué soporta FlowTrace; lo de arriba lo repite. Si alguna vez se contradicen,
manda el recurso — un agente puede consultarlo en vez de deducirlo.

---

## Instalación rápida

```bash
npm install -g @rixmerz/flowtrace
```

No uses `npx @rixmerz/flowtrace`: npm resuelve su configuración desde el
`package.json` más cercano al directorio actual, y `flowtrace run` se ejecuta
por definición dentro de tu proyecto — así que un proyecto que declara
`devEngines.packageManager` hace fallar a npx con `EBADDEVENGINES`, justo en
los proyectos que esto existe para trazar. El plugin de Claude Code deja
`flowtrace` en el PATH sin instalación global (se instala en su propia caché,
por la misma razón).

`@rixmerz/flowtrace` es el **único** paquete que hace falta para los seis
runtimes. Trae dentro las capas de captura: no hace falta Maven, ni pip, ni
instalar `@flowtrace/capture-node` (ese nombre no existe en npm — es un paquete
interno del workspace, y la CLI ya lo lleva vendorizado). El navegador es la
excepción: se instala aparte, arriba.

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

### Rust
```bash
flowtrace run -- cargo run --release
# `cargo build` y `cargo test` también funcionan
```
Requiere `cargo` en un host Unix; la compilación usa tu propio toolchain, Rust 1.81+.
La instrumentación ocurre en tiempo de compilación mediante un wrapper de `rustc`:
se compila una copia reescrita del `src/` de cada crate del workspace, así que tu
árbol de fuentes nunca se modifica. El prefijo de paquete se deriva del workspace
(`app` cubre `app_core` y `app_cli`). Para trazar un solo módulo de un camino
caliente, usa un prefijo más largo, por ejemplo `--package-prefix app::engine`.
`async fn`, `const fn` y el código `#[test]` no se instrumentan. Una función con
el cuerpo en la misma línea que sus llaves tampoco se instrumenta, para no
desplazar las columnas del `panic`; `rustfmt` la separa. Un `Err` devuelto y un
`panic` quedan ambos como `error` de la llamada. Un programa que ya usa `tracing`
puede añadir la capa `flowtrace-tracing` a su propio subscriber en su lugar.
Diseño, límites y overhead medido: `docs/changes/2026-11-22-rust-capture-layer.md`.

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
| Java | Automático — el agente OTel | Automático dentro de lo que instrumenta OTel |
| Node / TS | Automático — se parcha el server HTTP (express, fastify, koa, `http` pelado) | Automático — parcha `fetch` y `http.request` |
| Go | Automático — el transformer siembra todo `func(http.ResponseWriter, *http.Request)` | Manual |
| Rust | **Sólo `FLOWTRACE_TRACEPARENT`** — sin seam HTTP; FFI en proceso necesita `flowtrace::remote_context` | Manual — `flowtrace::current_traceparent()`; los hilos nuevos abren trazas nuevas |
| Python | **Sólo `FLOWTRACE_TRACEPARENT`** — el header HTTP no se adopta solo | Manual |

Todos los runtimes de arriba leen además `FLOWTRACE_TRACEPARENT`, así que para encadenar procesos
sin HTTP de por medio basta exportarlo antes de lanzar el hijo.

El **navegador** suele ser el origen de la cadena, no un salto intermedio: el
interceptor de Angular adjunta `traceparent` a cada request saliente, y para la
entrada se siembra la página con un `traceparent` renderizado por el servidor
(`initFlowtrace({ traceparent })`).

> **Si el front y la API están en orígenes distintos**, `traceparent` no está en
> la safelist de CORS: agregar el header convierte un request simple en uno con
> preflight. La API tiene que responder
> `Access-Control-Allow-Headers: Content-Type, traceparent` o **el request no
> ocurre**, y prender FlowTrace parece haber roto la app.

En Python hay que envolver el request a mano:

```python
from flowtrace_runtime import remote_context
with remote_context(request.headers.get("traceparent")):
    ...
```

Ojo: ese import sólo resuelve corriendo bajo `flowtrace run`. Si el mismo
código corre sin instrumentar, protégelo con un `try/except ImportError`.

En Go no hace falta escribir nada para la entrada, y **no debes** llamar a
`flowtracert` desde tu código: ese paquete sólo existe durante un build
instrumentado, así que importarlo rompería tu `go build` normal. Para la
salida, la propagación se adjunta a mano desde código ya instrumentado — no hay
dónde engancharse, `net/http` se resuelve en tiempo de compilación.

Rust lee `FLOWTRACE_TRACEPARENT` una sola vez al arrancar: cada span raíz del
proceso se une a esa traza, con padre el span que lo lanzó. No hay seam HTTP.
Una biblioteca Rust llamada en proceso por FFI tiene que envolver la llamada en
`flowtrace::remote_context(header)` con un header que le pase el llamador; si no,
sus raíces cuelgan del span del proceso, no del marco que hizo la llamada. Un span
iniciado en un hilo nuevo (`std::thread::spawn`, `tokio::spawn`) es una raíz con
un `trace_id` nuevo: pasa `flowtrace::current_traceparent()` y abre
`remote_context` allí. `capture/rust/flowtrace-rust/tests/cross_process.rs`
verifica el salto Python-a-Rust entre dos procesos reales.

### Verificar que la cadena quedó unida

Una traza partida se ve igual que una traza sana hasta que miras los ids.
Junta el archivo de cada proceso y confirma que comparten un solo `trace_id`:

```bash
for f in */.flowtrace/*.jsonl; do
  echo "$f: $(jq -r .trace_id "$f" | sort -u | tr '\n' ' ')"
done
```

Dos ids distintos significan que un salto perdió el header. Eso es el hallazgo.

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
| `trace_diff` | Compara solo *qué* métodos corrieron y su duración media (antes/después) |
| `trace_behavior_diff` | Compara el *comportamiento* de dos trazas (args, resultados, errores, estructura) — test de caracterización |

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

### Caracterización con trazas

```bash
flowtrace run -- python miapp.py                       # graba la base y versiónala
flowtrace diff base.jsonl .flowtrace/<nueva>.jsonl     # 0 igual · 1 distinto · 2 error
flowtrace diff base.jsonl nueva.jsonl --ignore-key created_at --ignore-method 'app.Logger.*' --json
```

`flowtrace run -o base.jsonl` vacía el archivo al empezar (`--append` para añadir
a una traza existente). Los ignores pueden ir en `characterisation.json` junto a la
base; cada entrada es un string o `{"name"|"key": ..., "reason": "..."}`, y `--json`
devuelve los motivos en `ignored.reasons`.

Ignora ts, duraciones, ids, hilos y file/line; normaliza `<redacted>` y hashes de
identidad. Ver [docs/es/caracterizacion-con-trazas.md](docs/es/caracterizacion-con-trazas.md).

---

## Dashboard

```bash
cd flowtrace-dashboard && npm start
# http://localhost:8765   (FLOWTRACE_DASHBOARD_PORT para cambiarlo)
```

Escucha sólo en `127.0.0.1` y sólo lee trazas dentro del directorio desde el
que arrancó (más `FLOWTRACE_DASHBOARD_ROOTS`). No tiene autenticación: es una
herramienta local, y una traza suele contener argumentos y valores de retorno.

Ver [flowtrace-dashboard/](flowtrace-dashboard/) para instrucciones completas.

---

## Migracion desde v1

Si usas logs v1 (`ENTER`/`EXIT`, `durationMicros`), consulta:

[docs/migration-v1-v2.md](docs/migration-v1-v2.md)

---

## Desarrollo

Requisitos: Node ≥ 20.6, pnpm 9.15.4 (`corepack enable`), JDK 21+, Maven 3.9+,
Python ≥ 3.9, Go ≥ 1.24, Rust ≥ 1.81 (`cargo`). La primera prueba de Java descarga ~24 MB (el agente
OTel, verificado por sha256).

```bash
pnpm install
make test          # todo; ésta es la fuente de verdad
```

Después de tocar…            | corre
---                          | ---
`mcp-server/src`             | `make bundle-mcp` (y `make bundle-diff` si es `behavior-diff.ts`)
`flowtrace-dashboard/`       | `make bundle-dashboard`
una capa de captura          | `make gen-golden` — y **revisa el diff**
`mcp-server/src/runtimes.ts` | `make check-docs`

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

MIT — ver [LICENSE](LICENSE)
