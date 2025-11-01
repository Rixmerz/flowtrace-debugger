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

## 🎯 TypeScript + React/Vue/Next.js Support

FlowTrace tiene **soporte completo para TypeScript** con decoradores ergonómicos para trazado automático.

### Características TypeScript

- ✅ **Definiciones de Tipos Completas** - Type safety con `.d.ts` incluidos
- ✅ **Decoradores @Trace** - Sintaxis ergonómica como Python/Java/Rust
- ✅ **React Hooks** - Compatibilidad con hooks personalizados y Context API
- ✅ **Next.js 14** - Soporte para App Router, API Routes, y Server Actions
- ✅ **Vue 3** - Composition API y Options API con TypeScript
- ✅ **Angular** - Decoradores para servicios y componentes

### Ejemplo Rápido

```typescript
import { TraceClass, Trace } from 'flowtrace-agent-js/decorators';

// Decorador de clase - traza todos los métodos
@TraceClass()
export class UserService {
  async getAllUsers(): Promise<User[]> {
    // Automáticamente trazado
    return await this.db.users.findAll();
  }

  // Decorador de método con opciones
  @Trace({ captureArgs: false })
  async login(email: string, password: string) {
    // Password no capturado en logs
    return await this.auth.login(email, password);
  }
}
```

### Ejemplos Completos

- **React + TypeScript**: [`examples/react-typescript/`](./examples/react-typescript/)
  - Hooks personalizados (`useUsers`)
  - Componentes funcionales
  - Context API con TypeScript
  - Vite + Hot Module Replacement

- **Next.js + TypeScript**: [`examples/nextjs-typescript/`](./examples/nextjs-typescript/)
  - App Router (Next.js 14)
  - API Routes con `@Trace`
  - Server Actions automáticos

- **Angular + TypeScript**: [`examples/angular-test/`](./examples/angular-test/)
  - Servicios con `@Injectable`
  - Componentes Angular
  - RxJS Observables

### Configuración tsconfig.json

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["flowtrace-agent-js"]
  }
}
```

---

## 📦 Lenguajes y Frameworks Soportados

### ✅ Completamente Funcionales

| Lenguaje | Frameworks | Instrumentación |
|----------|-----------|-----------------|
| **Java** ☕ | Spring Boot, Maven, Gradle | ByteBuddy Agent automático |
| **JavaScript/Node.js** 🟢 | Express, NestJS, Fastify, Koa | Proxy Objects automático |
| **TypeScript** 🔷 | React, Next.js, Angular, Vue, Node.js | Proxy + Decorators (`@Trace`) |
| **Python** 🐍 | Django, FastAPI, Flask | sys.settrace() automático |
| **Go** 🔵 | Gin, Echo, Chi, net/http | AST Transformer (`flowctl instrument`) |
| **Rust** 🦀 | Actix-web, Rocket, Axum | Proc Macros (`#[trace]`) |
| **.NET/C#** 💜 | ASP.NET Core, Minimal APIs, gRPC | Source Generators automático |

### 🔧 Herramientas de Instrumentación

- **Java**: JavaAgent con ByteBuddy (runtime)
- **JavaScript**: Proxy-based interceptor (runtime)
- **TypeScript**: Decoradores `@Trace` + Proxy Objects (runtime)
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

## ✅ Mejores Prácticas de Código por Lenguaje

FlowTrace funciona mejor con código bien estructurado. Aquí están las recomendaciones específicas para cada lenguaje:

### JavaScript/Node.js 🟢

**✅ Código Recomendado:**
```javascript
// Funciones declaradas al inicio
function fetchUserData() {
  return database.query('SELECT * FROM users');
}

function processUsers(users) {
  return users.map(user => ({...user, processed: true}));
}

// Uso después en endpoints/rutas
app.get('/api/users', async (req, res) => {
  const users = await fetchUserData();
  const processed = processUsers(users);
  res.json(processed);
});
```

**❌ Evitar:**
```javascript
// Dependencia en hoisting (mala práctica)
processData();  // Llamada antes de declaración

function processData() {
  return 'data';
}
```

**Por qué:** FlowTrace usa transformación AST que convierte `function` declarations a variables, lo cual puede romper código que depende de hoisting. El código bien estructurado (funciones declaradas antes de usarse) funciona perfectamente.

### Java ☕

**✅ Código Recomendado:**
```java
public class UserService {
    public List<User> fetchUsers() {
        return userRepository.findAll();
    }

    public void processUsers(List<User> users) {
        users.forEach(this::validateUser);
    }
}
```

**❌ Evitar:**
- Métodos estáticos en clases utilitarias sin instanciar
- Uso excesivo de reflexión
- Código que modifica bytecode en runtime

**Por qué:** FlowTrace para Java usa ByteBuddy que instrumenta métodos de instancia. El código OOP estándar funciona perfectamente.

### Python 🐍

**✅ Código Recomendado:**
```python
def fetch_user_data():
    return database.query("SELECT * FROM users")

def process_users(users):
    return [{"user": u, "processed": True} for u in users]

# Uso después
@app.route('/api/users')
def get_users():
    users = fetch_user_data()
    return jsonify(process_users(users))
```

**❌ Evitar:**
- Funciones dentro de funciones excesivamente anidadas
- Modificación de `sys.settrace` manualmente
- Decoradores que modifican firmas de funciones

**Por qué:** FlowTrace usa `sys.settrace()` que funciona mejor con código estructurado de forma clara.

### Go 🔵

**✅ Código Recomendado:**
```go
func FetchUsers() ([]User, error) {
    return db.Query("SELECT * FROM users")
}

func ProcessUsers(users []User) []ProcessedUser {
    result := make([]ProcessedUser, len(users))
    for i, user := range users {
        result[i] = ProcessUser(user)
    }
    return result
}
```

**❌ Evitar:**
- Funciones anónimas inline excesivas
- Código generado dinámicamente
- Uso de `unsafe` package

**Por qué:** FlowTrace usa transformación AST de Go que requiere funciones nombradas claras.

### Rust 🦀

**✅ Código Recomendado:**
```rust
#[trace]  // FlowTrace macro
pub fn fetch_users() -> Result<Vec<User>, Error> {
    database::query("SELECT * FROM users")
}

#[trace]
pub fn process_users(users: Vec<User>) -> Vec<ProcessedUser> {
    users.into_iter().map(process_user).collect()
}
```

**❌ Evitar:**
- Macros complejas que ocultan lógica
- Código `unsafe` extensivo
- Closures anónimas sin anotaciones

**Por qué:** FlowTrace usa macros procedurales que requieren funciones explícitas.

### .NET/C# 💜

**✅ Código Recomendado:**
```csharp
public class UserService
{
    public async Task<List<User>> FetchUsersAsync()
    {
        return await _dbContext.Users.ToListAsync();
    }

    public List<ProcessedUser> ProcessUsers(List<User> users)
    {
        return users.Select(ProcessUser).ToList();
    }
}
```

**❌ Evitar:**
- Modificación de IL en runtime
- Uso excesivo de reflexión
- Código dinámico con `dynamic` keyword

**Por qué:** FlowTrace usa Source Generators que requieren código estático analizable.

### 📋 Resumen General

**Principios Universales para Todos los Lenguajes:**

1. **Declarar antes de usar** - Funciones/métodos declarados antes de ser llamados
2. **Código explícito** - Evitar trucos de lenguaje que oculten flujo de ejecución
3. **Estructura clara** - Organización lógica con responsabilidades bien definidas
4. **Evitar metaprogramación excesiva** - Generación dinámica dificulta instrumentación
5. **Usar patrones estándar** - MVC, Clean Architecture, etc. funcionan perfectamente

**El código bien estructurado es código que FlowTrace puede instrumentar fácilmente.** Si sigues buenas prácticas de tu lenguaje, FlowTrace funcionará sin problemas.

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
