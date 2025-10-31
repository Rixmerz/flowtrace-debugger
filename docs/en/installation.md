# Installation Guide - FlowTrace Debugger

## System Requirements

### For Java
- Java 8 or higher
- Maven 3.x or Gradle

### For Node.js
- Node.js 14.x or higher
- npm or yarn

---

## Global Installation

### 1. Clone the Repository

```bash
git clone git@github.com:Rixmerz/flowtrace-debugger.git
cd flowtrace-debugger
```

### 2. Run Installer

```bash
./install-all.sh
```

This script will install:
- `flowtrace-agent` (Java agent JAR)
- `flowtrace-agent-js` (Node.js module)
- `flowtrace-cli` (command-line tool)
- `flowtrace-mcp-server` (MCP server for analysis)

### 3. Verify Installation

```bash
flowtrace --version
# Output: 1.0.0
```

---

## Project Installation

### Automatic Method (Recommended)

```bash
cd /path/to/your/project
flowtrace init --yes
```

This will automatically detect:
- Project type (Java/Node.js)
- Framework used
- Package prefix
- Entry point

### Manual Method

```bash
cd /path/to/your/project
flowtrace init
```

Answer the interactive questions:
1. **Language**: Java, Node.js, or Other
2. **Package Prefix**: e.g., `com.example.app`
3. **Entry Point**: e.g., `target/app.jar` or `src/index.js`
4. **Create Launcher**: Yes/No
5. **Shell**: Bash, Zsh, or PowerShell

---

## Manual Configuration (Advanced)

### Java (Maven)

1. **Add agent to your `pom.xml`** (optional):
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

2. **Run manually**:
```bash
java -javaagent:.flowtrace/flowtrace-agent.jar \
     -Dflowtrace.package-prefix=com.example.app \
     -jar target/app.jar
```

### Node.js

1. **Add to `package.json`**:
```json
{
  "scripts": {
    "trace": "node -r .flowtrace/flowtrace-agent-js src/index.js"
  }
}
```

2. **Create `.env` file**:
```bash
FLOWTRACE_PACKAGE_PREFIX=app
FLOWTRACE_LOGFILE=flowtrace.jsonl
FLOWTRACE_STDOUT=false
```

3. **Run**:
```bash
npm run trace
```

---

## Update

```bash
cd /path/to/flowtrace-debugger
git pull
./install-all.sh
```

Then in your projects:
```bash
flowtrace update
```

---

## Uninstallation

### Global
```bash
npm uninstall -g flowtrace-cli
rm -rf ~/.flowtrace
```

### From Project
```bash
rm -rf .flowtrace
rm run-and-flowtrace.sh
# Remove flowtrace.jsonl entries from .gitignore
```

---

## Troubleshooting

### "command not found: flowtrace"

**Cause**: CLI not properly installed

**Solution**:
```bash
cd /path/to/flowtrace-debugger
./install-flowtrace-cli.sh
```

### "No such file or directory: flowtrace-agent.jar"

**Cause**: Agent not compiled

**Solution**:
```bash
cd /path/to/flowtrace-debugger/flowtrace-agent
mvn clean package
cp target/flowtrace-agent-1.0.0.jar ~/.flowtrace/
```

### "Error loading agent"

**Cause**: Incompatible Java version

**Solution**: Verify you're using Java 8+
```bash
java -version
```

---

## Next Steps

- [Configuration Guide](./configuration.md)
- [Usage Guide](./usage.md)
- [Back to README](../../README.en.md)
