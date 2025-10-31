# FlowTrace Debugger - Roadmap

[🇺🇸 English](#english) | [🇪🇸 Español](#español)

---

<a name="english"></a>
## 🇺🇸 English

This roadmap outlines the planned features and improvements for FlowTrace Debugger.

### ✅ Current Status (v1.0)

**Supported Languages:**
- ✅ Java (bytecode instrumentation via Java Agent)
- ✅ Node.js/JavaScript (require hook instrumentation)

**Features:**
- ✅ Method-level tracing (ENTER/EXIT events)
- ✅ Argument and return value capture
- ✅ Execution time measurement (microseconds & milliseconds)
- ✅ JSONL log format
- ✅ Package prefix filtering (reduce noise)
- ✅ CLI tool for easy initialization
- ✅ MCP server for log analysis
- ✅ Support for major frameworks (Spring Boot, Express, NestJS, etc.)

---

### 🚀 Phase 1: Multi-Language Support (Q2 2025)

#### Python Agent (Priority: High)
- **Goal**: Full Python tracing support via `sys.settrace()` or decorator-based instrumentation
- **Features**:
  - Function/method call tracing
  - Module prefix filtering (e.g., `myapp.`, `src.`)
  - Django, Flask, FastAPI framework support
  - Async/await support
- **Status**: 🔴 Not Started
- **Help Wanted**: Python developers familiar with introspection

#### Go Agent (Priority: Medium)
- **Goal**: Go application tracing via instrumentation
- **Approach**:
  - Option 1: AST transformation at build time
  - Option 2: Compiler plugin
  - Option 3: eBPF-based tracing (requires kernel support)
- **Features**:
  - Goroutine tracking
  - Package prefix filtering
  - gin, echo, fiber framework support
- **Status**: 🔴 Not Started
- **Help Wanted**: Go developers with compiler/AST experience

#### Rust Agent (Priority: Medium)
- **Goal**: Rust application tracing
- **Approach**:
  - Procedural macro for instrumentation (`#[trace]`)
  - Compile-time code injection
- **Features**:
  - Function tracing
  - Crate filtering
  - actix-web, rocket, axum framework support
  - Zero-cost abstractions
- **Status**: 🔴 Not Started
- **Help Wanted**: Rust developers with macro experience

#### .NET/C# Agent (Priority: Medium)
- **Goal**: .NET Framework and .NET Core tracing
- **Approach**:
  - CLR Profiling API
  - IL (Intermediate Language) rewriting
- **Features**:
  - Method tracing
  - Namespace filtering
  - ASP.NET Core, Entity Framework support
- **Status**: 🔴 Not Started
- **Help Wanted**: C# developers with CLR profiling experience

---

### 🎯 Phase 2: Enhanced Features (Q3 2025)

#### Advanced Filtering
- **Regex-based filtering** for complex patterns
- **Exclude patterns** (blacklist certain methods/classes)
- **Conditional tracing** (trace only if condition met)
- **Sampling** (trace X% of calls for high-traffic apps)

#### Performance Optimization
- **Zero-copy logging** (reduce memory overhead)
- **Async log writing** (non-blocking I/O)
- **Circular buffer** (limit memory usage)
- **Compression** (gzip JSONL logs on-the-fly)

#### Enhanced CLI
- **`flowtrace analyze`** - Built-in log analysis
- **`flowtrace visualize`** - Generate call graphs
- **`flowtrace export`** - Export to different formats (CSV, JSON, Parquet)
- **`flowtrace benchmark`** - Measure overhead impact

---

### 📊 Phase 3: Analysis & Visualization (Q4 2025)

#### MCP Server Enhancements
- **Real-time log streaming** via WebSocket
- **Query language** for complex log filtering
- **Aggregation functions** (count, avg, percentiles)
- **Anomaly detection** (identify unusual patterns)

#### Web Dashboard
- **Interactive UI** for log exploration
- **Call graph visualization** (D3.js or similar)
- **Timeline view** (see execution flow over time)
- **Performance hotspot detection**
- **Flame graphs** for performance profiling

#### AI Integration
- **LLM-powered insights** (summarize execution flows)
- **Intelligent bug detection** (identify potential issues)
- **Performance recommendations** (suggest optimizations)
- **Code smell detection** (identify anti-patterns)

---

### 🔧 Phase 4: Enterprise Features (2026)

#### Distributed Tracing
- **OpenTelemetry integration**
- **Correlation IDs** for multi-service tracing
- **Service mesh support** (Istio, Linkerd)
- **Cross-language tracing** (Java → Node.js → Python)

#### Persistence & Storage
- **Database backends** (PostgreSQL, MongoDB, ClickHouse)
- **Time-series storage** for performance metrics
- **Retention policies** (auto-delete old logs)
- **Data aggregation** (reduce storage cost)

#### Security & Compliance
- **PII redaction** (automatically mask sensitive data)
- **Audit logging** (who accessed what logs)
- **Encryption** (at rest and in transit)
- **Access control** (RBAC for log access)

---

### 🌐 Community & Ecosystem

#### Integrations
- **IDE plugins** (VS Code, IntelliJ IDEA)
- **CI/CD integrations** (GitHub Actions, GitLab CI)
- **APM tool integrations** (Datadog, New Relic, Dynatrace)
- **Logging platforms** (Splunk, ELK stack)

#### Documentation
- **Video tutorials**
- **Interactive examples**
- **Best practices guide**
- **Architecture deep-dive**

#### Community
- **Discord server** for discussions
- **Monthly community calls**
- **Contributor recognition program**
- **Bounty program** for critical features

---

### 📅 Timeline Summary

| Phase | Timeline | Status |
|-------|----------|--------|
| **Phase 1**: Multi-language support | Q2 2025 | 🔴 Not Started |
| **Phase 2**: Enhanced features | Q3 2025 | 🔴 Not Started |
| **Phase 3**: Analysis & visualization | Q4 2025 | 🔴 Not Started |
| **Phase 4**: Enterprise features | 2026 | 🔴 Not Started |

---

### 🤝 How to Contribute

Interested in helping with any of these features? See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

**Priority areas for contributions:**
1. **Python agent** - Most requested feature
2. **Go agent** - Second most requested
3. **Web dashboard** - Great for frontend developers
4. **Documentation** - Always needed!

---

<a name="español"></a>
## 🇪🇸 Español

Esta hoja de ruta describe las características y mejoras planificadas para FlowTrace Debugger.

### ✅ Estado Actual (v1.0)

**Lenguajes Soportados:**
- ✅ Java (instrumentación bytecode vía Java Agent)
- ✅ Node.js/JavaScript (instrumentación require hook)

**Características:**
- ✅ Tracing a nivel de método (eventos ENTER/EXIT)
- ✅ Captura de argumentos y valores de retorno
- ✅ Medición de tiempo de ejecución (microsegundos y milisegundos)
- ✅ Formato de log JSONL
- ✅ Filtrado por package prefix (reducir ruido)
- ✅ Herramienta CLI para inicialización fácil
- ✅ Servidor MCP para análisis de logs
- ✅ Soporte para frameworks principales (Spring Boot, Express, NestJS, etc.)

---

### 🚀 Fase 1: Soporte Multi-Lenguaje (Q2 2025)

#### Agente Python (Prioridad: Alta)
- **Objetivo**: Soporte completo de tracing Python vía `sys.settrace()` o instrumentación basada en decoradores
- **Características**:
  - Tracing de llamadas a funciones/métodos
  - Filtrado por prefijo de módulo (ej., `myapp.`, `src.`)
  - Soporte frameworks Django, Flask, FastAPI
  - Soporte async/await
- **Estado**: 🔴 No Iniciado
- **Se Busca Ayuda**: Desarrolladores Python familiarizados con introspección

#### Agente Go (Prioridad: Media)
- **Objetivo**: Tracing de aplicaciones Go vía instrumentación
- **Enfoque**:
  - Opción 1: Transformación AST en tiempo de compilación
  - Opción 2: Plugin de compilador
  - Opción 3: Tracing basado en eBPF (requiere soporte kernel)
- **Características**:
  - Tracking de goroutines
  - Filtrado por prefijo de paquete
  - Soporte frameworks gin, echo, fiber
- **Estado**: 🔴 No Iniciado
- **Se Busca Ayuda**: Desarrolladores Go con experiencia en compilador/AST

#### Agente Rust (Prioridad: Media)
- **Objetivo**: Tracing de aplicaciones Rust
- **Enfoque**:
  - Macro procedimental para instrumentación (`#[trace]`)
  - Inyección de código en tiempo de compilación
- **Características**:
  - Tracing de funciones
  - Filtrado por crate
  - Soporte frameworks actix-web, rocket, axum
  - Abstracciones de costo cero
- **Estado**: 🔴 No Iniciado
- **Se Busca Ayuda**: Desarrolladores Rust con experiencia en macros

#### Agente .NET/C# (Prioridad: Media)
- **Objetivo**: Tracing .NET Framework y .NET Core
- **Enfoque**:
  - CLR Profiling API
  - Reescritura IL (Intermediate Language)
- **Características**:
  - Tracing de métodos
  - Filtrado por namespace
  - Soporte ASP.NET Core, Entity Framework
- **Estado**: 🔴 No Iniciado
- **Se Busca Ayuda**: Desarrolladores C# con experiencia en profiling CLR

---

### 🎯 Fase 2: Características Mejoradas (Q3 2025)

#### Filtrado Avanzado
- **Filtrado basado en regex** para patrones complejos
- **Patrones de exclusión** (lista negra para ciertos métodos/clases)
- **Tracing condicional** (trazar solo si se cumple condición)
- **Sampling** (trazar X% de llamadas para apps de alto tráfico)

#### Optimización de Rendimiento
- **Logging zero-copy** (reducir overhead de memoria)
- **Escritura asíncrona de logs** (I/O no bloqueante)
- **Buffer circular** (limitar uso de memoria)
- **Compresión** (gzip logs JSONL al vuelo)

#### CLI Mejorado
- **`flowtrace analyze`** - Análisis de logs integrado
- **`flowtrace visualize`** - Generar grafos de llamadas
- **`flowtrace export`** - Exportar a diferentes formatos (CSV, JSON, Parquet)
- **`flowtrace benchmark`** - Medir impacto de overhead

---

### 📊 Fase 3: Análisis y Visualización (Q4 2025)

#### Mejoras al Servidor MCP
- **Streaming de logs en tiempo real** vía WebSocket
- **Lenguaje de consulta** para filtrado complejo de logs
- **Funciones de agregación** (count, avg, percentiles)
- **Detección de anomalías** (identificar patrones inusuales)

#### Dashboard Web
- **UI interactiva** para exploración de logs
- **Visualización de grafos de llamadas** (D3.js o similar)
- **Vista de timeline** (ver flujo de ejecución en el tiempo)
- **Detección de hotspots de rendimiento**
- **Flame graphs** para profiling de rendimiento

#### Integración con IA
- **Insights potenciados por LLM** (resumir flujos de ejecución)
- **Detección inteligente de bugs** (identificar problemas potenciales)
- **Recomendaciones de rendimiento** (sugerir optimizaciones)
- **Detección de code smells** (identificar anti-patrones)

---

### 🔧 Fase 4: Características Enterprise (2026)

#### Distributed Tracing
- **Integración OpenTelemetry**
- **Correlation IDs** para tracing multi-servicio
- **Soporte service mesh** (Istio, Linkerd)
- **Tracing multi-lenguaje** (Java → Node.js → Python)

#### Persistencia y Almacenamiento
- **Backends de base de datos** (PostgreSQL, MongoDB, ClickHouse)
- **Almacenamiento time-series** para métricas de rendimiento
- **Políticas de retención** (auto-eliminar logs antiguos)
- **Agregación de datos** (reducir costo de almacenamiento)

#### Seguridad y Cumplimiento
- **Redacción PII** (enmascarar automáticamente datos sensibles)
- **Audit logging** (quién accedió qué logs)
- **Encriptación** (en reposo y en tránsito)
- **Control de acceso** (RBAC para acceso a logs)

---

### 🌐 Comunidad y Ecosistema

#### Integraciones
- **Plugins para IDEs** (VS Code, IntelliJ IDEA)
- **Integraciones CI/CD** (GitHub Actions, GitLab CI)
- **Integraciones con herramientas APM** (Datadog, New Relic, Dynatrace)
- **Plataformas de logging** (Splunk, ELK stack)

#### Documentación
- **Tutoriales en video**
- **Ejemplos interactivos**
- **Guía de mejores prácticas**
- **Deep-dive de arquitectura**

#### Comunidad
- **Servidor Discord** para discusiones
- **Llamadas comunitarias mensuales**
- **Programa de reconocimiento de contribuidores**
- **Programa de bounties** para características críticas

---

### 📅 Resumen de Timeline

| Fase | Timeline | Estado |
|------|----------|--------|
| **Fase 1**: Soporte multi-lenguaje | Q2 2025 | 🔴 No Iniciado |
| **Fase 2**: Características mejoradas | Q3 2025 | 🔴 No Iniciado |
| **Fase 3**: Análisis y visualización | Q4 2025 | 🔴 No Iniciado |
| **Fase 4**: Características enterprise | 2026 | 🔴 No Iniciado |

---

### 🤝 Cómo Contribuir

¿Interesado en ayudar con alguna de estas características? Ver [CONTRIBUTING.md](./CONTRIBUTING.md) para pautas.

**Áreas prioritarias para contribuciones:**
1. **Agente Python** - Característica más solicitada
2. **Agente Go** - Segunda más solicitada
3. **Dashboard web** - Genial para desarrolladores frontend
4. **Documentación** - ¡Siempre necesaria!
