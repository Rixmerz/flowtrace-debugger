# 🚀 Guía de Activación - FlowTrace MCP Tools

## ✅ Pre-requisitos

Antes de activar las nuevas herramientas, verifica que tienes todo instalado:

```bash
# 1. FlowTrace CLI (REQUERIDO)
npm install -g flowtrace
flowtrace --version

# 2. Node.js (REQUERIDO)
node --version  # Debe ser >= 18.0.0

# 3. Build ya completado
cd mcp-server
ls -la dist/flowtrace-tools.js  # Debe existir
```

---

## 📝 Pasos de Activación

### Opción 1: Claude Desktop (Recomendado)

#### Paso 1: Localizar archivo de configuración

```bash
# macOS
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Linux
nano ~/.config/Claude/claude_desktop_config.json

# Windows
notepad %APPDATA%\Claude\claude_desktop_config.json
```

#### Paso 2: Agregar configuración FlowTrace

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/RUTA_ABSOLUTA/flowtrace-for-all/flowtrace/mcp-server/dist/server.js"],
      "cwd": "/RUTA_ABSOLUTA/flowtrace-for-all/flowtrace/mcp-server",
      "env": {}
    }
  }
}
```

**⚠️ IMPORTANTE**: Reemplazar `/RUTA_ABSOLUTA/` con tu ruta real.

Para encontrar tu ruta absoluta:
```bash
cd flowtrace-for-all/flowtrace/mcp-server
pwd
# Copia el resultado y úsalo en la configuración
```

#### Paso 3: Reiniciar Claude Desktop

1. Cerrar completamente Claude Desktop
2. Abrir nuevamente
3. Las herramientas deberían estar disponibles automáticamente

---

### Opción 2: Cursor

#### Paso 1: Crear/editar archivo de configuración

```bash
# Crear directorio si no existe
mkdir -p ~/.cursor

# Editar configuración
nano ~/.cursor/mcp.json
```

#### Paso 2: Agregar configuración

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/RUTA_ABSOLUTA/flowtrace-for-all/flowtrace/mcp-server/dist/server.js"],
      "cwd": "/RUTA_ABSOLUTA/flowtrace-for-all/flowtrace/mcp-server",
      "env": {}
    }
  }
}
```

#### Paso 3: Reiniciar Cursor

1. Cerrar Cursor completamente
2. Abrir nuevamente
3. Verificar que las herramientas estén disponibles

---

## ✅ Verificación de Instalación

### Test 1: Verificar herramientas disponibles

En Claude o Cursor, pregunta:

```
¿Qué herramientas de flowtrace están disponibles?
```

Deberías ver:
- `flowtrace.init`
- `flowtrace.detect`
- `flowtrace.build`
- `flowtrace.execute`
- `flowtrace.cleanup`
- `flowtrace.status`

### Test 2: Probar detección

```
Usando flowtrace.detect, analiza el proyecto en /ruta/a/tu/proyecto
```

Debería retornar información sobre el lenguaje y framework.

### Test 3: Verificar estado

```
Usando flowtrace.status, verifica el estado de /ruta/a/tu/proyecto
```

Debería retornar información de inicialización y logs.

---

## 🧪 Prueba Completa

### Crear proyecto de prueba:

```bash
# Crear proyecto Node.js simple
mkdir ~/test-flowtrace
cd ~/test-flowtrace
npm init -y
npm install express

# Crear app simple
cat > index.js << 'EOF'
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello FlowTrace!');
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
EOF
```

### Probar herramientas en Claude/Cursor:

```
1. Detecta el proyecto en ~/test-flowtrace
2. Inicializa FlowTrace en ese proyecto
3. Construye el proyecto
4. Verifica el estado
```

Si todo funciona correctamente, deberías ver:
1. ✅ Detección: `language: "node"`, `framework: "express"`
2. ✅ Inicialización: Crear `.flowtrace/` y `run-and-flowtrace.sh`
3. ✅ Build: Ejecutar `npm install`
4. ✅ Estado: Mostrar configuración y logs

---

## 🔧 Solución de Problemas

### Problema: "MCP server not found"

**Causa**: Ruta incorrecta en configuración

**Solución**:
```bash
# Verificar ruta correcta
cd flowtrace-for-all/flowtrace/mcp-server
pwd
# Copiar resultado exacto en configuración
```

### Problema: "Command not found: node"

**Causa**: Node.js no está en PATH

**Solución**:
```bash
# Usar ruta completa de node
which node
# Usar la ruta completa en "command"
```

Ejemplo:
```json
{
  "command": "/usr/local/bin/node",  // Ruta completa
  "args": [...]
}
```

### Problema: "flowtrace command not found"

**Causa**: FlowTrace CLI no instalado

**Solución**:
```bash
npm install -g flowtrace
flowtrace --version
```

### Problema: "Cannot find module"

**Causa**: Dependencias no instaladas

**Solución**:
```bash
cd mcp-server
npm install
npm run build
```

### Problema: "Tools not appearing"

**Checklist**:
1. ✅ Verificar archivo de configuración existe
2. ✅ Verificar ruta es absoluta (no relativa)
3. ✅ Verificar `dist/server.js` existe
4. ✅ Reiniciar Claude/Cursor después de cambios
5. ✅ Verificar permisos de archivo

---

## 📊 Verificación de Logs

### Ver logs de Claude Desktop:

```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp*.log

# Linux
tail -f ~/.local/share/Claude/logs/mcp*.log
```

### Ver logs de Cursor:

```bash
tail -f ~/.cursor/logs/mcp*.log
```

Buscar líneas como:
```
FlowTrace MCP Server running on stdio
Tool registered: flowtrace.init
Tool registered: flowtrace.detect
...
```

---

## 🎯 Configuración de Ejemplo Completa

### Para macOS:

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "/usr/local/bin/node",
      "args": [
        "/Users/tuusuario/my_projects/flowtrace-for-all/flowtrace/mcp-server/dist/server.js"
      ],
      "cwd": "/Users/tuusuario/my_projects/flowtrace-for-all/flowtrace/mcp-server",
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Para Linux:

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "/usr/bin/node",
      "args": [
        "/home/tuusuario/projects/flowtrace-for-all/flowtrace/mcp-server/dist/server.js"
      ],
      "cwd": "/home/tuusuario/projects/flowtrace-for-all/flowtrace/mcp-server",
      "env": {}
    }
  }
}
```

### Para Windows:

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\TuUsuario\\projects\\flowtrace-for-all\\flowtrace\\mcp-server\\dist\\server.js"
      ],
      "cwd": "C:\\Users\\TuUsuario\\projects\\flowtrace-for-all\\flowtrace\\mcp-server",
      "env": {}
    }
  }
}
```

---

## 📝 Checklist de Activación

- [ ] FlowTrace CLI instalado globalmente (`npm install -g flowtrace`)
- [ ] Node.js >= 18.0.0 instalado
- [ ] MCP server compilado (`npm run build` en mcp-server/)
- [ ] Archivo `dist/server.js` existe
- [ ] Configuración agregada a Claude/Cursor
- [ ] Ruta absoluta correcta en configuración
- [ ] Claude/Cursor reiniciado
- [ ] Herramientas visibles en cliente
- [ ] Test de detección funcionando
- [ ] Test de status funcionando

---

## 🎉 ¡Listo!

Una vez completados todos los pasos, las herramientas de FlowTrace estarán completamente activas y la IA podrá:

- ✅ Inicializar proyectos automáticamente
- ✅ Detectar lenguajes y frameworks
- ✅ Construir proyectos
- ✅ Ejecutar con instrumentación
- ✅ Gestionar logs
- ✅ Monitorear estado

---

## 📚 Próximos Pasos

1. **Leer ejemplos de uso**: Ver `USAGE_EXAMPLES.md`
2. **Probar con proyecto real**: Usar tus propios proyectos
3. **Explorar workflows**: Ver workflows en documentación
4. **Reportar issues**: Si encuentras problemas

---

## 📞 Ayuda

Si necesitas ayuda:
1. Verificar logs del MCP server
2. Revisar configuración (rutas absolutas)
3. Verificar prerequisitos instalados
4. Revisar documentación en README.md

---

**¡Disfruta de la autonomía completa de FlowTrace!** 🚀
