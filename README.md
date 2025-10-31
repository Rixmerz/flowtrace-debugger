# FlowTrace Debugger

[🇺🇸 English](./README.en.md) | 🇪🇸 Español

Tracing inteligente para Java y Node.js (Python, Go, Rust, .NET próximamente). Genera logs JSON de llamadas a métodos para análisis con IA.

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

## 📦 Frameworks Soportados

**Java**: Spring Boot, Maven
**Node.js**: Express, NestJS, Fastify, Koa, Angular, React, Vue, Next.js

**🚧 Próximamente**: Python, Go, Rust, .NET/C#

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
