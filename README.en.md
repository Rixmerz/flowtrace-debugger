# FlowTrace Debugger

🇺🇸 English | [🇪🇸 Español](./README.md)

Intelligent tracing for Java and Node.js (Python, Go, Rust, .NET coming soon). Generates JSON logs of method calls for AI-powered analysis.

---

## 🚀 Installation

```bash
git clone git@github.com:Rixmerz/flowtrace-debugger.git
cd flowtrace-debugger
./install-all.sh
```

Verify:
```bash
flowtrace --version  # 1.0.0
```

---

## 💡 Usage

### In your project (Java or Node.js)

**Option 1: Automatic (Recommended)**
```bash
cd /path/to/your/project
flowtrace init --yes
```

**Option 2: Manual**
```bash
cd /path/to/your/project
flowtrace init
# Answer the TUI questions
```

### Run

```bash
./run-and-flowtrace.sh
```

### View logs

```bash
cat flowtrace.jsonl
cat flowtrace.jsonl | jq
```

---

## 📁 Generated Files

```
your-project/
├── .flowtrace/
│   ├── config.json              # Configuration
│   └── flowtrace-agent.jar      # Java agent (or flowtrace-agent-js/ for Node)
├── run-and-flowtrace.sh         # Execution script
├── flowtrace.jsonl              # Logs (auto git-ignored)
└── .gitignore                   # Updated
```

---

## ⚙️ Configuration

### Environment Variables (Node.js)

Create `.env` in your project:
```bash
FLOWTRACE_PACKAGE_PREFIX=app
FLOWTRACE_LOGFILE=flowtrace.jsonl
FLOWTRACE_STDOUT=false
FLOWTRACE_MAX_ARG_LENGTH=0        # 0 = no truncation
```

### Java Properties

```bash
-Dflowtrace.package-prefix=com.example.app
-Dflowtrace.logfile=flowtrace.jsonl
-Dflowtrace.stdout=false
-Dflowtrace.max-arg-length=0       # 0 = no truncation
```

---

## 🎯 Package Prefix (Important)

Filters which code to instrument:

**Without prefix**: Captures EVERYTHING (frameworks, libraries) → huge logs, slow app

**With prefix**: Only your code → small logs, fast app

Examples:
- Java: `com.example.app` or `com.mycompany.myapp`
- Node: `app`, `src/controllers`, `@mycompany/my-api`

The CLI automatically detects the prefix with `--yes`.

---

## 📋 Log Format

```json
{"timestamp":1635789012345,"event":"ENTER","thread":"main","class":"UserController","method":"createUser","args":"[{\"name\":\"John\"}]"}
{"timestamp":1635789012567,"event":"EXIT","thread":"main","class":"UserController","method":"createUser","args":"[{\"name\":\"John\"}]","result":"{\"id\":123}","durationMicros":222000,"durationMillis":222}
```

---

## 🔧 Commands

```bash
flowtrace init          # Initialize project
flowtrace init --yes    # Automatic initialization (recommended)
flowtrace update        # Update agent
flowtrace status        # View configuration
```

---

## 🚨 Troubleshooting

**"command not found: flowtrace"**
```bash
./install-all.sh
```

**"empty flowtrace.jsonl"**

Verify that the package prefix matches your code.

**Update after git pull**
```bash
./install-all.sh
cd /path/to/project
flowtrace update
```

---

## 📦 Supported Frameworks

**Java**: Spring Boot, Maven
**Node.js**: Express, NestJS, Fastify, Koa, Angular, React, Vue, Next.js

**🚧 Coming Soon**: Python, Go, Rust, .NET/C#

---

## 📖 Documentation

- [Installation Guide](./docs/en/installation.md)
- [Configuration Guide](./docs/en/configuration.md)
- [Usage Guide](./docs/en/usage.md)
- [Roadmap](./ROADMAP.md)

---

## 🤝 Contributing

Contributions are welcome! Read [CONTRIBUTING.md](./CONTRIBUTING.md) for more information.

---

## 📄 License

MIT License - See [LICENSE](./LICENSE) for details.

---

## 🔗 Links

- **GitHub**: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger)
- **Issues**: [Report an issue](https://github.com/Rixmerz/flowtrace-debugger/issues)
- **Contribute**: [Pull Requests](https://github.com/Rixmerz/flowtrace-debugger/pulls)
