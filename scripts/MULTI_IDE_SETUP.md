# FlowTrace Multi-IDE MCP Configuration

## 📋 Overview

Sistema de configuración automática del servidor MCP de FlowTrace para múltiples IDEs y agentes AI.

## 🎯 IDEs Soportados

| IDE | Ruta de Configuración | Estructura |
|-----|----------------------|------------|
| **Cursor** | `~/.cursor/mcp.json` | Simple (mcpServers + cwd) |
| **Claude Code** | `~/Library/Application Support/Claude/claude_desktop_config.json` | Simple (mcpServers + cwd) |
| **Gemini** | `~/.gemini/settings.json` | Compleja (ide + mcpServers + security, sin cwd) |

## 🚀 Uso

### Durante la Instalación

El script `install-all.sh` ejecuta automáticamente el configurador después de compilar el MCP server:

```bash
./install-all.sh
# ... instalación normal ...
# Aparece menú interactivo para seleccionar IDEs
```

### Configuración Manual Posterior

```bash
# Ejecutar configurador standalone
bash scripts/configure-mcp.sh
```

### Menú Interactivo

```
📦 Selecciona dónde configurar el MCP Server:

  1. Cursor
  2. Claude Code
  3. Gemini
  4. Todos los anteriores

Puedes seleccionar múltiples opciones separadas por comas
Ejemplo: 1,2,3 para configurar Cursor, Claude Code y Gemini

Ingresa tu selección: _
```

## 📝 Ejemplos de Selección

| Entrada | IDEs Configurados | Descripción |
|---------|------------------|-------------|
| `1` | Cursor | Solo Cursor |
| `2` | Claude Code | Solo Claude Code |
| `3` | Gemini | Solo Gemini |
| `4` | Todos | Cursor + Claude Code + Gemini |
| `1,2` | Cursor + Claude Code | Múltiple selección |
| `1,3` | Cursor + Gemini | Múltiple selección |
| `1,2,3` | Todos | Equivalente a opción 4 |
| `1, 2, 3` | Todos | Espacios son ignorados |

## 🔧 Arquitectura

### Componentes

```
scripts/
├── configure-mcp.sh          # Script bash principal (TUI selector)
├── mcp-configurator.py       # Módulo Python (merge JSON)
├── test-mcp-configurator.sh  # Suite de tests automatizados
├── test-interactive.sh       # Tests de validación interactiva
└── ide-configs/              # Templates de referencia
    ├── cursor-template.json
    ├── claude-template.json
    ├── gemini-template.json
    └── README.md
```

### Flujo de Ejecución

```
┌─────────────────────┐
│  configure-mcp.sh   │
│  (Bash TUI)         │
└──────────┬──────────┘
           │
           ├── Muestra menú interactivo
           ├── Valida selección del usuario
           ├── Para cada IDE seleccionado:
           │   │
           │   └──> ┌────────────────────────┐
           │        │  mcp-configurator.py   │
           │        │  (Python JSON merger)   │
           │        └─────────┬──────────────┘
           │                  │
           │                  ├── Lee config existente
           │                  ├── Crea backup (.backup.timestamp)
           │                  ├── Merge FlowTrace MCP config
           │                  └── Escribe config actualizado
           │
           └── Muestra resumen de configuración
```

## 📐 Estructuras de Configuración

### Cursor / Claude Code (Simple)

```json
{
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/server.js"],
      "cwd": "/path/to/mcp-server",
      "env": {}
    }
  }
}
```

### Gemini (Compleja)

```json
{
  "ide": {
    "hasSeenNudge": true,
    "enabled": true
  },
  "mcpServers": {
    "flowtrace": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/server.js"],
      "env": {}
    }
  },
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  }
}
```

**Nota**: Gemini NO incluye `cwd` en mcpServers.

## 🧪 Testing

### Tests Automatizados

```bash
# Suite completa de tests
bash scripts/test-mcp-configurator.sh

# Tests:
# ✓ Python configurator exists
# ✓ Bash configurator exists
# ✓ Python configurator syntax valid
# ✓ Templates exist
# ✓ Templates are valid JSON
# ✓ Cursor config structure valid
# ✓ Gemini config structure valid
# ✓ Python configurator shows help
```

### Tests de Validación

```bash
# Tests de validación de entrada
bash scripts/test-interactive.sh

# Valida:
# ✓ Selecciones válidas (1, 2, 3, 4)
# ✓ Múltiples selecciones (1,2, 1,2,3)
# ✓ Espacios son ignorados (1, 2, 3 → 1,2,3)
# ✓ Entradas inválidas rechazadas (5, abc, 1;2)
```

## 🔒 Seguridad

### Backups Automáticos

Antes de modificar cualquier archivo de configuración, se crea un backup:

```
~/.cursor/mcp.json → ~/.cursor/mcp.json.backup.20250131_143022
```

### Merge Seguro

El sistema hace merge inteligente preservando:
- Configuraciones MCP existentes de otros servidores
- Estructuras específicas del IDE (ide, security en Gemini)
- Variables de entorno personalizadas

### Validación

- Verificación de rutas absolutas
- Validación de JSON antes de escribir
- Comprobación de existencia de server.js
- Manejo de errores con mensajes informativos

## 📊 Características

### ✅ Implementadas

- [x] Selector TUI interactivo con colores
- [x] Selección múltiple con comas (1,2,3)
- [x] Validación robusta de entrada
- [x] Soporte para 3 IDEs (Cursor, Claude Code, Gemini)
- [x] Merge inteligente preservando configs existentes
- [x] Backups automáticos con timestamp
- [x] Manejo de estructura especial de Gemini
- [x] Scripts de testing automatizados
- [x] Documentación completa
- [x] Templates de referencia
- [x] Integración con install-all.sh

### 🎯 Ventajas

1. **Usuario-Friendly**: TUI simple y clara
2. **Seguro**: Backups automáticos antes de modificar
3. **Flexible**: Selección individual o múltiple
4. **Robusto**: Validación completa de entradas
5. **Preserva Configuración**: No sobrescribe otros MCPs
6. **Testeable**: Suite completa de tests
7. **Documentado**: README y templates incluidos

## 🚨 Solución de Problemas

### Error: "Python configurator not found"

```bash
# Verifica que el archivo existe
ls scripts/mcp-configurator.py

# Reinstala si es necesario
cd flowtrace
./install-all.sh
```

### Error: "MCP server not found"

```bash
# Compila el MCP server
cd mcp-server
npm install
npm run build
```

### Error: "Permission denied"

```bash
# Haz los scripts ejecutables
chmod +x scripts/configure-mcp.sh
chmod +x scripts/mcp-configurator.py
```

### Config no funciona después de configurar

1. Reinicia tu IDE completamente
2. Verifica que las rutas en el config sean absolutas
3. Verifica que `dist/server.js` exista:
   ```bash
   ls mcp-server/dist/server.js
   ```

## 📚 Referencias

- [Configuración Manual](./ide-configs/README.md)
- [MCP Server README](../mcp-server/README.md)
- [MCP Tools Documentation](../mcp-server/MCP_TOOLS.md)
- [FlowTrace Installation Guide](../docs/es/installation.md)

## 🤝 Contribuir

Para agregar soporte para nuevos IDEs:

1. Agregar entrada en `MCPConfigurator.IDE_CONFIGS` (mcp-configurator.py)
2. Implementar `_get_default_structure()` para el IDE
3. Agregar opción en el menú (configure-mcp.sh)
4. Crear template en `ide-configs/`
5. Agregar tests
6. Actualizar documentación

## 📄 Licencia

MIT License - Ver [LICENSE](../LICENSE)
