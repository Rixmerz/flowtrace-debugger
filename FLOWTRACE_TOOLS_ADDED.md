# FlowTrace MCP Server - Nuevas Herramientas Agregadas

## ✅ Implementación Completada

Se han agregado exitosamente **6 nuevas herramientas** al MCP server existente de FlowTrace para proporcionar autonomía completa en la inicialización, construcción, ejecución y limpieza de proyectos con FlowTrace.

---

## 🛠️ Herramientas Agregadas

### 1. **flowtrace.init**
**Propósito**: Inicializar FlowTrace en un proyecto

**Funcionalidad**:
- Ejecuta `flowtrace init --yes` automáticamente
- Crea directorio `.flowtrace/` y configuración
- Descarga el agente apropiado (Node.js o Java)
- Genera el script `run-and-flowtrace.sh`
- Detecta si ya está inicializado y retorna config existente

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto
- `autoYes` (opcional, default: true): Saltar prompts interactivos
- `language` (opcional): Sobrescribir detección automática (node|java|python)

**Ejemplo de uso**:
```typescript
flowtrace.init({
  projectPath: "/Users/user/my-project",
  autoYes: true
})
```

---

### 2. **flowtrace.detect**
**Propósito**: Detectar lenguaje y framework del proyecto

**Funcionalidad**:
- Detecta **Node.js** (package.json)
- Detecta **Java** (pom.xml, build.gradle)
- Detecta **Python** (requirements.txt)
- Identifica frameworks: React, Express, Spring Boot, Django, FastAPI
- Retorna puerto por defecto según framework

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto

**Retorna**:
```json
{
  "success": true,
  "language": "node",
  "framework": "react-cra",
  "defaultPort": 3000,
  "indicators": ["package.json"]
}
```

---

### 3. **flowtrace.build**
**Propósito**: Construir proyecto según lenguaje detectado

**Funcionalidad**:
- **Node.js**: Ejecuta `npm install`
- **Java**: Ejecuta `mvn clean package` o `mvn package`
- **Python**: Ejecuta `pip install -r requirements.txt`
- Timeout de 10 minutos para builds largos

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto
- `clean` (opcional, default: true): Limpiar antes de compilar (solo Java)

**Ejemplo**:
```typescript
flowtrace.build({
  projectPath: "/Users/user/spring-boot-app",
  clean: true
})
```

---

### 4. **flowtrace.execute**
**Propósito**: Ejecutar aplicación con instrumentación FlowTrace

**Funcionalidad**:
- Ejecuta el script `run-and-flowtrace.sh` generado
- Corre en background automáticamente
- Captura stdout y stderr
- Valida que el script existe antes de ejecutar

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto
- `timeout` (opcional, default: 60): Timeout en segundos

**Ejemplo**:
```typescript
flowtrace.execute({
  projectPath: "/Users/user/my-app",
  timeout: 90
})
```

---

### 5. **flowtrace.cleanup**
**Propósito**: Limpiar logs de FlowTrace para iteraciones de testing

**Funcionalidad**:
- Limpia `flowtrace.jsonl` (log principal)
- Elimina archivos en `flowtrace-jsonsl/` (logs truncados)
- Reporta espacio liberado en MB
- Lista archivos eliminados

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto
- `cleanMain` (opcional, default: true): Limpiar log principal
- `cleanTruncated` (opcional, default: true): Limpiar logs truncados

**Retorna**:
```json
{
  "success": true,
  "filesDeleted": ["flowtrace.jsonl", "flowtrace-jsonsl/file1.json"],
  "bytesFreed": 15728640,
  "bytesFreedMB": "15.00"
}
```

---

### 6. **flowtrace.status**
**Propósito**: Obtener estado completo del proyecto FlowTrace

**Funcionalidad**:
- Verifica si está inicializado
- Lee configuración de `.flowtrace/config.json`
- Verifica existencia de logs
- Cuenta archivos truncados
- Reporta tamaños de archivos

**Parámetros**:
- `projectPath` (requerido): Ruta absoluta al proyecto

**Retorna**:
```json
{
  "success": true,
  "initialized": true,
  "config": { /* configuración */ },
  "logs": {
    "mainLogExists": true,
    "mainLogSize": 1048576,
    "truncatedLogCount": 5
  }
}
```

---

## 🔄 Flujo de Trabajo Completo

```typescript
// 1. Detectar tipo de proyecto
const detection = await flowtrace.detect({
  projectPath: "/path/to/my-project"
});
// → Language: node, Framework: react-cra

// 2. Inicializar FlowTrace
await flowtrace.init({
  projectPath: "/path/to/my-project",
  autoYes: true
});
// → Crea .flowtrace/, descarga agente, genera run-and-flowtrace.sh

// 3. Construir proyecto
await flowtrace.build({
  projectPath: "/path/to/my-project"
});
// → Ejecuta npm install

// 4. Ejecutar con instrumentación
await flowtrace.execute({
  projectPath: "/path/to/my-project",
  timeout: 60
});
// → Corre con agente FlowTrace adjunto

// 5. Revisar estado
await flowtrace.status({
  projectPath: "/path/to/my-project"
});
// → Muestra estado y estadísticas de logs

// 6. Limpiar logs para próxima iteración
await flowtrace.cleanup({
  projectPath: "/path/to/my-project"
});
// → Elimina logs, listo para ejecución fresca
```

---

## 📁 Archivos Modificados/Creados

### **Archivos Creados**:
1. `mcp-server/src/flowtrace-tools.ts` - Implementación de las 6 herramientas
2. `mcp-server/src/lib/detectors/` - Copiado desde flowtrace-mcp-server
3. `mcp-server/src/lib/builders/` - Copiado desde flowtrace-mcp-server
4. `mcp-server/src/lib/utils/` - Copiado desde flowtrace-mcp-server

### **Archivos Modificados**:
1. `mcp-server/src/server.ts` - Agregado import y registro de nuevas herramientas
2. `mcp-server/README.md` - Actualizado con documentación de las 6 herramientas

---

## 🎯 Ventajas de la IA

### **Antes** (manual):
```bash
# Usuario ejecuta manualmente:
flowtrace init --yes
mvn clean package
./run-and-flowtrace.sh
# ... monitorea logs manualmente
rm flowtrace.jsonl
```

### **Ahora** (autónomo):
```typescript
// IA ejecuta automáticamente:
await flowtrace.detect({ projectPath: "/path" });
await flowtrace.init({ projectPath: "/path" });
await flowtrace.build({ projectPath: "/path" });
await flowtrace.execute({ projectPath: "/path" });
await flowtrace.cleanup({ projectPath: "/path" });
```

**Beneficios**:
- ✅ **Autonomía completa**: IA puede configurar y ejecutar sin intervención humana
- ✅ **Detección inteligente**: Identifica lenguaje/framework automáticamente
- ✅ **Gestión de logs**: Limpieza automática para testing iterativo
- ✅ **Menos errores**: Comandos consistentes, sin errores de tipeo
- ✅ **Más rápido**: Flujo de trabajo completo en un solo comando

---

## 🔧 Compilación y Testing

### **Build Exitoso**:
```bash
cd mcp-server
npm run build
# ✅ Compilado sin errores
```

### **Archivos Generados**:
- `dist/flowtrace-tools.js` - Herramientas compiladas
- `dist/server.js` - Servidor actualizado

---

## 📊 Soporte de Lenguajes

### **Node.js**
- ✅ Detección via `package.json`
- ✅ Frameworks: React CRA, Next.js, Express, Angular, Vue
- ✅ Build: `npm install`

### **Java**
- ✅ Detección via `pom.xml`, `build.gradle`
- ✅ Frameworks: Spring Boot
- ✅ Build: `mvn clean package` o `gradle build`

### **Python**
- ✅ Detección via `requirements.txt`
- ✅ Frameworks: Django, FastAPI, Flask
- ✅ Build: `pip install -r requirements.txt`

---

## ⚡ Casos de Uso

### **1. Testing Iterativo**
```typescript
// Limpiar logs anteriores
await flowtrace.cleanup({ projectPath: "/path" });

// Ejecutar test
await flowtrace.execute({ projectPath: "/path", timeout: 60 });

// Analizar logs
await log.open({ path: "/path/flowtrace.jsonl" });
```

### **2. Setup Inicial de Proyecto**
```typescript
// Detectar proyecto
const detection = await flowtrace.detect({ projectPath: "/new-project" });

// Inicializar según detección
await flowtrace.init({
  projectPath: "/new-project",
  language: detection.language
});

// Build
await flowtrace.build({ projectPath: "/new-project" });
```

### **3. Monitoreo de Estado**
```typescript
// Revisar estado antes de ejecutar
const status = await flowtrace.status({ projectPath: "/path" });

if (!status.initialized) {
  await flowtrace.init({ projectPath: "/path" });
}

if (status.logs.mainLogSize > 10000000) { // >10MB
  await flowtrace.cleanup({ projectPath: "/path" });
}
```

---

## 🚀 Próximos Pasos

### **Uso Inmediato**:
1. El servidor ya está compilado y listo
2. Las herramientas están disponibles en el MCP server existente
3. No se requiere configuración adicional

### **Testing Recomendado**:
1. Probar con proyecto Node.js (React)
2. Probar con proyecto Java (Spring Boot)
3. Validar flujo completo de detección → init → build → execute → cleanup

### **Mejoras Futuras Posibles**:
- Agregar `flowtrace.health_check` para validar que la app esté corriendo
- Agregar soporte para más frameworks (NestJS, Laravel, etc.)
- Agregar validación de puertos antes de ejecutar
- Agregar opción de ejecutar en modo detached/foreground

---

## 📝 Resumen

**✅ 6 herramientas agregadas al MCP server existente**
**✅ Autonomía completa para workflows de FlowTrace**
**✅ Soporte multi-lenguaje (Node.js, Java, Python)**
**✅ Detección inteligente de frameworks**
**✅ Gestión automática de logs**
**✅ Documentación actualizada**
**✅ Build exitoso sin errores**

**Resultado**: La IA ahora puede gestionar completamente el ciclo de vida de FlowTrace sin intervención manual, desde la inicialización hasta la limpieza de logs.
