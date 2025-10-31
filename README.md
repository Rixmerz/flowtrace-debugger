# FlowTrace Debugger

[🇺🇸 English](./README.en.md) | 🇪🇸 Español

Instrumentación automática multi-lenguaje con tracing inteligente. Genera logs JSON estructurados de llamadas a métodos para análisis con IA.

**Lenguajes Soportados**: Java ☕ | JavaScript/Node.js 🟢 | Python 🐍 | Go 🔵 | Rust 🦀 | .NET/C# 💜

---

## 🚀 Instalación

```bash
git clone <repository-url>
cd flowtrace
./install-all.sh
```

Verifica:
```bash
flowtrace --version  # 1.0.0
```

---

## 💡 Uso

### En tu proyecto (Java o Node.js)

**Opción 1: Automática (Recomendado)**
```bash
cd /path/to/your/project
flowtrace init --yes
```

**Opción 2: Manual**
```bash
cd /path/to/your/project
flowtrace init
# Responde las preguntas del TUI
```

### Ejecutar

```bash
./run-and-flowtrace.sh
```

### Ver logs

```bash
cat flowtrace.jsonl
cat flowtrace.jsonl | jq
```

---

## 📁 Archivos Generados

```
tu-proyecto/
├── .flowtrace/
│   ├── config.json              # Configuración
│   └── flowtrace-agent.jar      # Java agent (o flowtrace-agent-js/ para Node)
├── run-and-flowtrace.sh         # Script de ejecución
├── flowtrace.jsonl              # Logs (auto git-ignored)
└── .gitignore                   # Actualizado
```

---

## ⚙️ Configuración

### Variables de Entorno (Node.js)

Crea `.env` en tu proyecto:
```bash
FLOWTRACE_PACKAGE_PREFIX=app
FLOWTRACE_LOGFILE=flowtrace.jsonl
FLOWTRACE_STDOUT=false
FLOWTRACE_MAX_ARG_LENGTH=0        # 0 = sin truncar
```

### Java Properties

```bash
-Dflowtrace.package-prefix=com.example.app
-Dflowtrace.logfile=flowtrace.jsonl
-Dflowtrace.stdout=false
-Dflowtrace.max-arg-length=0       # 0 = sin truncar
```

---

## 🎯 Package Prefix (Importante)

Filtra qué código instrumentar:

**Sin prefix**: Captura TODO (frameworks, librerías) → logs gigantes, app lenta

**Con prefix**: Solo tu código → logs pequeños, app rápida

Ejemplos:
- Java: `com.example.app` o `com.mycompany.myapp`
- Node: `app`, `src/controllers`, `@mycompany/my-api`

El CLI detecta el prefix automáticamente con `--yes`.

---

## 📋 Formato de Logs

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"main","class":"UserController","method":"createUser","args":"[{\"name\":\"John\"}]"}
{"timestamp":1635789012567,"event":"EXIT","thread":"main","class":"UserController","method":"createUser","args":"[{\"name\":\"John\"}]","result":"{\"id\":123}","durationMicros":222000,"durationMillis":222}
```

---

## 🔧 Comandos

```bash
flowtrace init          # Inicializar proyecto
flowtrace init --yes    # Inicializar automático (recomendado)
flowtrace update        # Actualizar agente
flowtrace status        # Ver configuración
```

---

## 🚨 Problemas

**"command not found: flowtrace"**
```bash
./install-all.sh
```

**"flowtrace.jsonl vacío"**

Verifica el package prefix coincida con tu código.

**Actualizar después de git pull**
```bash
./install-all.sh
cd /path/to/project
flowtrace update
```

---

## 🤖 Integración con AI IDEs (MCP Server)

FlowTrace incluye un servidor MCP para análisis de logs con IA. Soporta múltiples IDEs:

### Configuración Automática durante Instalación

Durante `./install-all.sh`, se presenta un menú interactivo para configurar:

- **1. Cursor** (`~/.cursor/mcp.json`)
- **2. Claude Code** (`~/Library/Application Support/Claude/claude_desktop_config.json`)
- **3. Gemini** (`~/.gemini/settings.json`)
- **4. Todos** (configura los 3 automáticamente)

**Selección múltiple**: Puedes elegir varios IDEs a la vez (ej: `1,2,3`)

### Configuración Manual Posterior

```bash
# Ejecuta el configurador interactivo
bash scripts/configure-mcp.sh

# Selecciona tu(s) IDE(s)
# Ejemplo: 1,3 para Cursor y Gemini
```

### Herramientas MCP Disponibles

- `log.open` - Abrir archivo JSONL de logs
- `log.search` - Buscar eventos con filtros
- `log.aggregate` - Agregar métricas
- `log.schema` - Ver estructura de datos

**Documentación completa**: [`mcp-server/MCP_TOOLS.md`](./mcp-server/MCP_TOOLS.md)

---

## 📦 Lenguajes y Frameworks Soportados

### ✅ Completamente Funcionales

| Lenguaje | Frameworks | Instrumentación |
|----------|-----------|-----------------|
| **Java** ☕ | Spring Boot, Maven, Gradle | ByteBuddy Agent automático |
| **JavaScript/Node.js** 🟢 | Express, NestJS, Fastify, Koa, Angular, React, Vue, Next.js | Proxy Objects automático |
| **Python** 🐍 | Django, FastAPI, Flask | sys.settrace() automático |
| **Go** 🔵 | Gin, Echo, Chi, net/http | AST Transformer (`flowctl instrument`) |
| **Rust** 🦀 | Actix-web, Rocket, Axum | Proc Macros (`#[trace]`) |
| **.NET/C#** 💜 | ASP.NET Core, Minimal APIs, gRPC | Source Generators automático |

### 🔧 Herramientas de Instrumentación

- **Java**: JavaAgent con ByteBuddy (runtime)
- **JavaScript**: Proxy-based interceptor (runtime)
- **Python**: `flowctl-py` con decoradores automáticos
- **Go**: `flowctl instrument` con AST transformation
- **Rust**: `#[trace]` macro procedural
- **.NET**: Source Generators con Roslyn

---

## 📖 Documentación

- [Guía de Instalación](./docs/es/installation.md)
- [Guía de Configuración](./docs/es/configuration.md)
- [Guía de Uso](./docs/es/usage.md)
- [Hoja de Ruta](./ROADMAP.md)

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](./CONTRIBUTING.md) para más información.

---

## 📄 Licencia

MIT License - Ver [LICENSE](./LICENSE) para más detalles.

---

## 🔗 Enlaces

- **GitHub**: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger)
- **Issues**: [Reportar un problema](https://github.com/Rixmerz/flowtrace-debugger/issues)
- **Contribuir**: [Pull Requests](https://github.com/Rixmerz/flowtrace-debugger/pulls)

---

## 📧 Contacto

**Autor**: Juan Pablo Díaz
**Email**: juanpablo516@gmail.com
**GitHub**: [@Rixmerz](https://github.com/Rixmerz)

Para preguntas, sugerencias o colaboraciones, no dudes en contactar por email o abrir un issue en GitHub.

---

## 💖 Apoyar el Proyecto

Si FlowTrace te ha sido útil y quieres apoyar su desarrollo continuo, considera hacer una donación:

[![PayPal](https://img.shields.io/badge/PayPal-Donar-blue.svg?logo=paypal)](https://paypal.me/Rixmerz516)

**Donaciones vía PayPal**: [https://paypal.me/Rixmerz516](https://paypal.me/Rixmerz516)

Tu apoyo ayuda a mantener el proyecto activo y seguir agregando nuevas funcionalidades. ¡Gracias! 🙏
