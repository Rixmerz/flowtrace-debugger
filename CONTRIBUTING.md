# Contributing to FlowTrace Debugger

[🇺🇸 English](#english) | [🇪🇸 Español](#español)

---

<a name="english"></a>
## 🇺🇸 English

Thank you for considering contributing to FlowTrace Debugger! This document outlines the process for contributing to this project.

### Code of Conduct

This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

### How Can I Contribute?

#### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title** describing the problem
- **Steps to reproduce** the behavior
- **Expected vs actual** behavior
- **Environment details** (OS, Java/Node version, etc.)
- **Log files** or error messages if applicable

#### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When suggesting an enhancement:

- **Use a clear title** describing the enhancement
- **Provide detailed description** of the proposed feature
- **Explain why this enhancement** would be useful
- **List any alternatives** you've considered

#### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow coding standards**:
   - Java: Follow Oracle's Java Code Conventions
   - JavaScript/TypeScript: Use ESLint configuration provided
   - Use meaningful variable/function names
   - Add comments for complex logic
3. **Write tests** for new features
4. **Update documentation** if changing functionality
5. **Ensure all tests pass** before submitting
6. **Write clear commit messages**:
   ```
   feat: add Python agent support
   fix: resolve memory leak in Java agent
   docs: update installation guide
   ```

### Development Setup

```bash
# Clone your fork
git clone git@github.com:YOUR_USERNAME/flowtrace-debugger.git
cd flowtrace-debugger

# Install dependencies
./install-all.sh

# Run tests
cd flowtrace-agent && mvn test
cd ../flowtrace-agent-js && npm test
cd ../mcp-server && npm test
```

### Project Structure

```
flowtrace-debugger/
├── flowtrace-agent/        # Java bytecode instrumentation agent
├── flowtrace-agent-js/     # Node.js require hook agent
├── flowtrace-cli/          # CLI tool for initialization
├── mcp-server/             # MCP server for log analysis
├── agents/                 # Future: Python, Go, Rust, .NET agents
└── examples/               # Example projects
```

### Language-Specific Contributions

#### Adding Support for a New Language

We're actively seeking contributors for:
- **Python** tracing agent
- **Go** tracing agent
- **Rust** tracing agent
- **.NET/C#** tracing agent

See [ROADMAP.md](./ROADMAP.md) for detailed plans.

### Style Guides

#### Git Commit Messages

- Use present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- Limit first line to 72 characters
- Reference issues and pull requests after first line

#### JavaScript/TypeScript

- Use ESLint configuration provided
- Prefer `const` over `let`, avoid `var`
- Use async/await over promises when possible
- Add JSDoc comments for public APIs

#### Java

- Follow Oracle's Java Code Conventions
- Use Javadoc for public methods
- Keep methods small and focused
- Avoid deep nesting

### Testing

- Write unit tests for new features
- Ensure existing tests pass
- Add integration tests for complex features
- Test on multiple platforms if possible

### Documentation

- Update README.md if changing user-facing features
- Add/update JSDoc or Javadoc comments
- Update language-specific guides in `docs/`
- Keep documentation in sync across English/Spanish versions

### Questions?

Feel free to ask questions by:
- Opening a GitHub issue
- Starting a discussion in GitHub Discussions

---

<a name="español"></a>
## 🇪🇸 Español

¡Gracias por considerar contribuir a FlowTrace Debugger! Este documento describe el proceso para contribuir a este proyecto.

### Código de Conducta

Este proyecto se adhiere a un [Código de Conducta](./CODE_OF_CONDUCT.md). Al participar, se espera que respetes este código.

### ¿Cómo Puedo Contribuir?

#### Reportar Errores

Antes de crear reportes de errores, verifica los issues existentes para evitar duplicados. Al crear un reporte de error, incluye:

- **Título claro** describiendo el problema
- **Pasos para reproducir** el comportamiento
- **Comportamiento esperado vs actual**
- **Detalles del entorno** (SO, versión Java/Node, etc.)
- **Archivos de log** o mensajes de error si aplica

#### Sugerir Mejoras

Las sugerencias de mejora se rastrean como issues de GitHub. Al sugerir una mejora:

- **Usa un título claro** describiendo la mejora
- **Proporciona descripción detallada** de la función propuesta
- **Explica por qué esta mejora** sería útil
- **Lista alternativas** que hayas considerado

#### Pull Requests

1. **Haz fork del repositorio** y crea tu rama desde `main`
2. **Sigue los estándares de código**:
   - Java: Sigue las Convenciones de Código Java de Oracle
   - JavaScript/TypeScript: Usa la configuración ESLint proporcionada
   - Usa nombres significativos para variables/funciones
   - Agrega comentarios para lógica compleja
3. **Escribe tests** para nuevas funciones
4. **Actualiza la documentación** si cambias funcionalidad
5. **Asegúrate de que todos los tests pasen** antes de enviar
6. **Escribe mensajes de commit claros**:
   ```
   feat: agregar soporte para agente Python
   fix: resolver fuga de memoria en agente Java
   docs: actualizar guía de instalación
   ```

### Configuración de Desarrollo

```bash
# Clona tu fork
git clone git@github.com:TU_USUARIO/flowtrace-debugger.git
cd flowtrace-debugger

# Instala dependencias
./install-all.sh

# Ejecuta tests
cd flowtrace-agent && mvn test
cd ../flowtrace-agent-js && npm test
cd ../mcp-server && npm test
```

### Estructura del Proyecto

```
flowtrace-debugger/
├── flowtrace-agent/        # Agente de instrumentación bytecode Java
├── flowtrace-agent-js/     # Agente require hook Node.js
├── flowtrace-cli/          # Herramienta CLI para inicialización
├── mcp-server/             # Servidor MCP para análisis de logs
├── agents/                 # Futuro: agentes Python, Go, Rust, .NET
└── examples/               # Proyectos de ejemplo
```

### Contribuciones Específicas por Lenguaje

#### Agregar Soporte para un Nuevo Lenguaje

Estamos buscando activamente contribuidores para:
- Agente de tracing para **Python**
- Agente de tracing para **Go**
- Agente de tracing para **Rust**
- Agente de tracing para **.NET/C#**

Ver [ROADMAP.md](./ROADMAP.md) para planes detallados.

### Guías de Estilo

#### Mensajes de Commit Git

- Usa tiempo presente ("add feature" no "added feature")
- Usa modo imperativo ("move cursor to..." no "moves cursor to...")
- Limita la primera línea a 72 caracteres
- Referencias issues y pull requests después de la primera línea

#### JavaScript/TypeScript

- Usa la configuración ESLint proporcionada
- Prefiere `const` sobre `let`, evita `var`
- Usa async/await sobre promesas cuando sea posible
- Agrega comentarios JSDoc para APIs públicas

#### Java

- Sigue las Convenciones de Código Java de Oracle
- Usa Javadoc para métodos públicos
- Mantén los métodos pequeños y enfocados
- Evita anidamiento profundo

### Testing

- Escribe pruebas unitarias para nuevas funciones
- Asegúrate de que las pruebas existentes pasen
- Agrega pruebas de integración para funciones complejas
- Prueba en múltiples plataformas si es posible

### Documentación

- Actualiza README.md si cambias funciones de cara al usuario
- Agrega/actualiza comentarios JSDoc o Javadoc
- Actualiza guías específicas de lenguaje en `docs/`
- Mantén la documentación sincronizada entre versiones inglés/español

### ¿Preguntas?

Siéntete libre de hacer preguntas mediante:
- Abriendo un issue de GitHub
- Iniciando una discusión en GitHub Discussions
