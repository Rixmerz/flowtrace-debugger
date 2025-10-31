# Guía de Instalación - FlowTrace Debugger

## Requisitos del Sistema

### Para Java
- Java 8 o superior
- Maven 3.x o Gradle

### Para Node.js
- Node.js 14.x o superior
- npm o yarn

---

## Instalación Global

### 1. Clonar el Repositorio

```bash
git clone git@github.com:Rixmerz/flowtrace-debugger.git
cd flowtrace-debugger
```

### 2. Ejecutar Instalador

```bash
./install-all.sh
```

Este script instalará:
- `flowtrace-agent` (Java agent JAR)
- `flowtrace-agent-js` (Node.js módulo)
- `flowtrace-cli` (herramienta de línea de comandos)
- `flowtrace-mcp-server` (servidor MCP para análisis)

### 3. Verificar Instalación

```bash
flowtrace --version
# Output: 1.0.0
```

---

## Instalación en Proyecto

### Método Automático (Recomendado)

```bash
cd /ruta/a/tu/proyecto
flowtrace init --yes
```

Esto detectará automáticamente:
- Tipo de proyecto (Java/Node.js)
- Framework utilizado
- Package prefix
- Punto de entrada

### Método Manual

```bash
cd /ruta/a/tu/proyecto
flowtrace init
```

Responde las preguntas interactivas:
1. **Lenguaje**: Java, Node.js, u Otro
2. **Package Prefix**: e.g., `com.example.app`
3. **Entry Point**: e.g., `target/app.jar` o `src/index.js`
4. **Crear Launcher**: Sí/No
5. **Shell**: Bash, Zsh, o PowerShell

---

## Configuración Manual (Avanzado)

### Java (Maven)

1. **Agregar agente a tu `pom.xml`** (opcional):
```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-surefire-plugin</artifactId>
      <configuration>
        <argLine>
          -javaagent:.flowtrace/flowtrace-agent.jar
          -Dflowtrace.package-prefix=com.example.app
        </argLine>
      </configuration>
    </plugin>
  </plugins>
</build>
```

2. **Ejecutar manualmente**:
```bash
java -javaagent:.flowtrace/flowtrace-agent.jar \
     -Dflowtrace.package-prefix=com.example.app \
     -jar target/app.jar
```

### Node.js

1. **Agregar al `package.json`**:
```json
{
  "scripts": {
    "trace": "node -r .flowtrace/flowtrace-agent-js src/index.js"
  }
}
```

2. **Crear archivo `.env`**:
```bash
FLOWTRACE_PACKAGE_PREFIX=app
FLOWTRACE_LOGFILE=flowtrace.jsonl
FLOWTRACE_STDOUT=false
```

3. **Ejecutar**:
```bash
npm run trace
```

---

## Actualización

```bash
cd /ruta/a/flowtrace-debugger
git pull
./install-all.sh
```

Luego en tus proyectos:
```bash
flowtrace update
```

---

## Desinstalación

### Global
```bash
npm uninstall -g flowtrace-cli
rm -rf ~/.flowtrace
```

### Del Proyecto
```bash
rm -rf .flowtrace
rm run-and-flowtrace.sh
# Remover entradas de flowtrace.jsonl del .gitignore
```

---

## Solución de Problemas

### "command not found: flowtrace"

**Causa**: CLI no instalado correctamente

**Solución**:
```bash
cd /ruta/a/flowtrace-debugger
./install-flowtrace-cli.sh
```

### "No such file or directory: flowtrace-agent.jar"

**Causa**: Agente no compilado

**Solución**:
```bash
cd /ruta/a/flowtrace-debugger/flowtrace-agent
mvn clean package
cp target/flowtrace-agent-1.0.0.jar ~/.flowtrace/
```

### "Error loading agent"

**Causa**: Versión incompatible de Java

**Solución**: Verifica que estás usando Java 8+
```bash
java -version
```

---

## Próximos Pasos

- [Guía de Configuración](./configuration.md)
- [Guía de Uso](./usage.md)
- [Volver al README](../../README.md)
