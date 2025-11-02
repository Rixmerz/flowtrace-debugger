# FlowTrace MCP Tools - Ejemplos de Uso

Guía práctica para usar las nuevas herramientas de FlowTrace en el MCP server.

---

## 🚀 Inicio Rápido

### Escenario 1: Proyecto Node.js (React)

```typescript
// 1. Detectar el proyecto
const detection = await flowtrace.detect({
  projectPath: "/Users/user/my-react-app"
});

// Resultado:
{
  "success": true,
  "language": "node",
  "framework": "react-cra",
  "defaultPort": 3000,
  "indicators": ["package.json"]
}

// 2. Inicializar FlowTrace
const init = await flowtrace.init({
  projectPath: "/Users/user/my-react-app",
  autoYes: true
});

// Resultado:
{
  "success": true,
  "message": "FlowTrace initialized successfully",
  "configPath": "/Users/user/my-react-app/.flowtrace/config.json",
  "launcherPath": "/Users/user/my-react-app/run-and-flowtrace.sh"
}

// 3. Construir el proyecto
const build = await flowtrace.build({
  projectPath: "/Users/user/my-react-app"
});

// Resultado:
{
  "success": true,
  "language": "node",
  "buildCommand": "npm install",
  "stdout": "added 1234 packages..."
}

// 4. Ejecutar con instrumentación
const execute = await flowtrace.execute({
  projectPath: "/Users/user/my-react-app",
  timeout: 60
});

// Resultado:
{
  "success": true,
  "message": "Application started with FlowTrace instrumentation",
  "stdout": "Compiled successfully!..."
}

// 5. Verificar estado
const status = await flowtrace.status({
  projectPath: "/Users/user/my-react-app"
});

// Resultado:
{
  "success": true,
  "initialized": true,
  "config": { "language": "node", "packagePrefix": "my.app" },
  "logs": {
    "mainLogExists": true,
    "mainLogSize": 2048576,
    "truncatedLogCount": 3
  }
}
```

---

## 🎯 Escenarios Específicos

### Escenario 2: Testing Iterativo

```typescript
// Workflow completo para testing iterativo

// Paso 1: Limpiar logs de ejecución anterior
const cleanup = await flowtrace.cleanup({
  projectPath: "/Users/user/my-app",
  cleanMain: true,
  cleanTruncated: true
});

console.log(`Liberados ${cleanup.bytesFreedMB} MB de espacio`);

// Paso 2: Ejecutar aplicación con logs limpios
await flowtrace.execute({
  projectPath: "/Users/user/my-app",
  timeout: 60
});

// Paso 3: Analizar logs (usando herramientas existentes)
const session = await log.open({
  path: "/Users/user/my-app/flowtrace.jsonl"
});

// Paso 4: Repetir el ciclo para siguiente iteración
```

---

### Escenario 3: Proyecto Java Spring Boot

```typescript
// Workflow completo para aplicación Java

// 1. Detectar proyecto Spring Boot
const detection = await flowtrace.detect({
  projectPath: "/Users/user/spring-boot-app"
});

// Resultado:
{
  "language": "java",
  "framework": "spring-boot",
  "defaultPort": 8080
}

// 2. Inicializar con lenguaje específico
await flowtrace.init({
  projectPath: "/Users/user/spring-boot-app",
  autoYes: true,
  language: "java"
});

// 3. Construir con Maven (clean + package)
const build = await flowtrace.build({
  projectPath: "/Users/user/spring-boot-app",
  clean: true  // mvn clean package
});

// Resultado incluye:
{
  "buildCommand": "mvn clean package",
  "stdout": "BUILD SUCCESS..."
}

// 4. Ejecutar con timeout largo (Spring Boot es lento)
await flowtrace.execute({
  projectPath: "/Users/user/spring-boot-app",
  timeout: 90  // 90 segundos para Spring Boot
});
```

---

### Escenario 4: Proyecto Python Django

```typescript
// Workflow para aplicación Django

// 1. Detectar proyecto Django
const detection = await flowtrace.detect({
  projectPath: "/Users/user/django-app"
});

// Resultado:
{
  "language": "python",
  "framework": "django",
  "defaultPort": 8000
}

// 2. Inicializar FlowTrace
await flowtrace.init({
  projectPath: "/Users/user/django-app",
  autoYes: true,
  language: "python"
});

// 3. Instalar dependencias
await flowtrace.build({
  projectPath: "/Users/user/django-app"
  // Ejecuta: pip install -r requirements.txt
});

// 4. Ejecutar aplicación
await flowtrace.execute({
  projectPath: "/Users/user/django-app",
  timeout: 60
});
```

---

## 🔄 Workflows Completos

### Workflow 1: Setup Inicial de Proyecto Nuevo

```typescript
async function setupFlowTrace(projectPath) {
  console.log("🔍 Detectando proyecto...");
  const detection = await flowtrace.detect({ projectPath });
  console.log(`✅ Detectado: ${detection.language} - ${detection.framework}`);

  console.log("🚀 Inicializando FlowTrace...");
  const init = await flowtrace.init({ projectPath, autoYes: true });

  if (!init.success) {
    throw new Error(`Inicialización falló: ${init.error}`);
  }

  console.log("🔨 Construyendo proyecto...");
  const build = await flowtrace.build({ projectPath });

  if (!build.success) {
    throw new Error(`Build falló: ${build.error}`);
  }

  console.log("✅ Proyecto listo para ejecutar con FlowTrace");

  return { detection, init, build };
}

// Uso:
setupFlowTrace("/Users/user/my-project")
  .then(result => console.log("Setup completo!", result))
  .catch(error => console.error("Error:", error.message));
```

---

### Workflow 2: Ciclo de Testing Automatizado

```typescript
async function testingCycle(projectPath, iterations = 3) {
  for (let i = 1; i <= iterations; i++) {
    console.log(`\n🔄 Iteración ${i}/${iterations}`);

    // Limpiar logs anteriores
    console.log("🧹 Limpiando logs...");
    const cleanup = await flowtrace.cleanup({
      projectPath,
      cleanMain: true,
      cleanTruncated: true
    });
    console.log(`  Liberados: ${cleanup.bytesFreedMB} MB`);

    // Ejecutar aplicación
    console.log("▶️  Ejecutando aplicación...");
    const execute = await flowtrace.execute({
      projectPath,
      timeout: 60
    });

    if (!execute.success) {
      console.error(`  ❌ Ejecución falló: ${execute.error}`);
      continue;
    }

    // Esperar un poco para que se generen logs
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verificar logs generados
    console.log("📊 Verificando logs...");
    const status = await flowtrace.status({ projectPath });
    console.log(`  Tamaño de log: ${status.logs.mainLogSize} bytes`);
    console.log(`  Logs truncados: ${status.logs.truncatedLogCount}`);

    // Analizar logs aquí con las herramientas existentes
    // ...

    console.log(`✅ Iteración ${i} completa\n`);
  }
}

// Uso:
testingCycle("/Users/user/my-app", 3);
```

---

### Workflow 3: Monitoreo de Estado Continuo

```typescript
async function monitorProject(projectPath) {
  console.log("📊 Monitoreo de FlowTrace\n");

  // Verificar estado inicial
  const status = await flowtrace.status({ projectPath });

  if (!status.initialized) {
    console.log("⚠️  Proyecto no inicializado");
    console.log("🚀 Ejecutando inicialización automática...");

    await flowtrace.init({ projectPath, autoYes: true });
    console.log("✅ Inicialización completa");
  } else {
    console.log("✅ Proyecto ya inicializado");
  }

  // Verificar tamaño de logs
  const logSizeMB = status.logs.mainLogSize / (1024 * 1024);
  console.log(`\n📁 Información de Logs:`);
  console.log(`  Log principal: ${logSizeMB.toFixed(2)} MB`);
  console.log(`  Logs truncados: ${status.logs.truncatedLogCount} archivos`);

  // Limpiar si los logs son muy grandes
  if (logSizeMB > 10) {
    console.log("\n⚠️  Logs grandes detectados (>10 MB)");
    console.log("🧹 Ejecutando limpieza...");

    const cleanup = await flowtrace.cleanup({
      projectPath,
      cleanMain: true,
      cleanTruncated: true
    });

    console.log(`✅ Liberados ${cleanup.bytesFreedMB} MB`);
  }

  // Mostrar configuración
  if (status.config) {
    console.log(`\n⚙️  Configuración:`);
    console.log(`  Lenguaje: ${status.config.language}`);
    console.log(`  Package Prefix: ${status.config.packagePrefix}`);
  }
}

// Uso:
monitorProject("/Users/user/my-project");
```

---

## 🎯 Casos de Uso Avanzados

### Caso 1: Multi-Proyecto

```typescript
async function setupMultipleProjects(projects) {
  const results = [];

  for (const projectPath of projects) {
    console.log(`\n📦 Procesando: ${projectPath}`);

    try {
      // Detectar y configurar cada proyecto
      const detection = await flowtrace.detect({ projectPath });
      await flowtrace.init({ projectPath, autoYes: true });
      await flowtrace.build({ projectPath });

      results.push({
        path: projectPath,
        language: detection.language,
        framework: detection.framework,
        status: 'success'
      });

      console.log(`  ✅ Completado`);
    } catch (error) {
      results.push({
        path: projectPath,
        status: 'failed',
        error: error.message
      });

      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  return results;
}

// Uso:
const projects = [
  "/Users/user/react-app",
  "/Users/user/spring-boot-api",
  "/Users/user/django-backend"
];

setupMultipleProjects(projects)
  .then(results => {
    const succeeded = results.filter(r => r.status === 'success').length;
    console.log(`\n✅ ${succeeded}/${results.length} proyectos configurados`);
  });
```

---

### Caso 2: Validación Pre-Ejecución

```typescript
async function validateBeforeRun(projectPath) {
  console.log("🔍 Validando proyecto antes de ejecutar...\n");

  // 1. Verificar detección
  console.log("1️⃣ Detectando proyecto...");
  const detection = await flowtrace.detect({ projectPath });

  if (detection.language === "unknown") {
    throw new Error("No se pudo detectar el tipo de proyecto");
  }
  console.log(`  ✅ ${detection.language} - ${detection.framework}`);

  // 2. Verificar inicialización
  console.log("2️⃣ Verificando inicialización...");
  const status = await flowtrace.status({ projectPath });

  if (!status.initialized) {
    console.log("  ⚠️  No inicializado, inicializando ahora...");
    await flowtrace.init({ projectPath, autoYes: true });
  }
  console.log("  ✅ FlowTrace inicializado");

  // 3. Verificar build
  console.log("3️⃣ Verificando build...");
  const build = await flowtrace.build({ projectPath });

  if (!build.success) {
    throw new Error(`Build falló: ${build.error}`);
  }
  console.log("  ✅ Build exitoso");

  // 4. Limpiar logs anteriores
  console.log("4️⃣ Limpiando logs anteriores...");
  await flowtrace.cleanup({ projectPath });
  console.log("  ✅ Logs limpios");

  // 5. Ejecutar
  console.log("5️⃣ Ejecutando aplicación...");
  const execute = await flowtrace.execute({
    projectPath,
    timeout: detection.framework === "spring-boot" ? 90 : 60
  });

  if (!execute.success) {
    throw new Error(`Ejecución falló: ${execute.error}`);
  }
  console.log("  ✅ Aplicación ejecutando");

  console.log("\n🎉 Validación completa - aplicación corriendo con FlowTrace");
  return true;
}

// Uso:
validateBeforeRun("/Users/user/my-project")
  .then(() => console.log("✅ Todo listo"))
  .catch(error => console.error("❌ Error:", error.message));
```

---

## 📝 Notas Importantes

### Timeouts Recomendados

- **React/Express/Django**: 60 segundos
- **Spring Boot**: 90 segundos (arranque más lento)
- **Next.js**: 60 segundos
- **FastAPI**: 30 segundos

### Gestión de Logs

- Limpiar logs antes de cada iteración de testing
- Monitorear tamaño de logs (>10 MB = limpiar)
- Los logs truncados se guardan en `flowtrace-jsonsl/`

### Detección de Lenguaje

El sistema detecta automáticamente:
- **Node.js**: Busca `package.json`
- **Java**: Busca `pom.xml` o `build.gradle`
- **Python**: Busca `requirements.txt`

### Frameworks Soportados

- **Node.js**: React CRA, Next.js, Express, Angular, Vue
- **Java**: Spring Boot (Maven/Gradle)
- **Python**: Django, FastAPI, Flask

---

## 🚨 Troubleshooting

### Problema: "FlowTrace CLI not found"

**Solución**:
```bash
npm install -g flowtrace
```

### Problema: "Build failed"

**Verificar**:
1. Dependencias instaladas (npm, maven, pip)
2. Archivo de configuración existe (package.json, pom.xml, requirements.txt)
3. Permisos de escritura en el directorio

### Problema: "Execution timeout"

**Solución**: Aumentar timeout
```typescript
await flowtrace.execute({
  projectPath: "/path",
  timeout: 120  // 2 minutos
});
```

### Problema: "No logs generated"

**Verificar**:
1. Revisar `packagePrefix` en `.flowtrace/config.json`
2. Asegurar que coincide con el código instrumentado
3. Ejecutar `flowtrace.status` para verificar configuración

---

## ✅ Checklist de Uso

- [ ] Instalar FlowTrace CLI globalmente
- [ ] Ejecutar `flowtrace.detect` para verificar tipo de proyecto
- [ ] Ejecutar `flowtrace.init` para inicializar
- [ ] Ejecutar `flowtrace.build` para construir
- [ ] Ejecutar `flowtrace.execute` para correr
- [ ] Usar `flowtrace.status` para verificar
- [ ] Usar `flowtrace.cleanup` entre iteraciones

---

**¡Listo para usar FlowTrace con autonomía completa!** 🚀
