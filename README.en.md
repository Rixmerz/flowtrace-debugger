# FlowTrace Debugger

🇺🇸 English | [🇪🇸 Español](./README.md)

Multi-language automatic instrumentation with intelligent tracing. Generates structured JSON logs of method calls for AI-powered analysis.

**Supported Languages**: Java ☕ | JavaScript/Node.js 🟢 | Python 🐍 | Go 🔵 | Rust 🦀 | .NET/C# 💜

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

## 🤖 AI IDE Integration (MCP Server)

FlowTrace includes an MCP server for AI-powered log analysis. Supports multiple IDEs:

### Automatic Configuration during Installation

During `./install-all.sh`, an interactive menu allows you to configure:

- **1. Cursor** (`~/.cursor/mcp.json`)
- **2. Claude Code** (`~/Library/Application Support/Claude/claude_desktop_config.json`)
- **3. Gemini** (`~/.gemini/settings.json`)
- **4. All** (configures all 3 automatically)

**Multiple selection**: You can choose multiple IDEs at once (e.g., `1,2,3`)

### Manual Configuration Later

```bash
# Run the interactive configurator
bash scripts/configure-mcp.sh

# Select your IDE(s)
# Example: 1,3 for Cursor and Gemini
```

### Available MCP Tools

- `log.open` - Open JSONL log file
- `log.search` - Search events with filters
- `log.aggregate` - Aggregate metrics
- `log.schema` - View data structure

**Full documentation**: [`mcp-server/MCP_TOOLS.md`](./mcp-server/MCP_TOOLS.md)

---

## 📦 Supported Languages and Frameworks

### ✅ Fully Functional

| Language | Frameworks | Instrumentation |
|----------|-----------|-----------------|
| **Java** ☕ | Spring Boot, Maven, Gradle | Automatic ByteBuddy Agent |
| **JavaScript/Node.js** 🟢 | Express, NestJS, Fastify, Koa, Angular, React, Vue, Next.js | Automatic Proxy Objects |
| **Python** 🐍 | Django, FastAPI, Flask | Automatic sys.settrace() |
| **Go** 🔵 | Gin, Echo, Chi, net/http | AST Transformer (`flowctl instrument`) |
| **Rust** 🦀 | Actix-web, Rocket, Axum | Proc Macros (`#[trace]`) |
| **.NET/C#** 💜 | ASP.NET Core, Minimal APIs, gRPC | Automatic Source Generators |

### 🔧 Instrumentation Tools

- **Java**: JavaAgent with ByteBuddy (runtime)
- **JavaScript**: Proxy-based interceptor (runtime)
- **Python**: `flowctl-py` with automatic decorators
- **Go**: `flowctl instrument` with AST transformation
- **Rust**: `#[trace]` procedural macro
- **.NET**: Source Generators with Roslyn

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

## ✅ Best Code Practices by Language

FlowTrace works best with well-structured code. Here are the specific recommendations for each language:

### JavaScript/Node.js 🟢

**✅ Recommended Code:**
```javascript
// Functions declared at the beginning
function fetchUserData() {
  return database.query('SELECT * FROM users');
}

function processUsers(users) {
  return users.map(user => ({...user, processed: true}));
}

// Usage later in endpoints/routes
app.get('/api/users', async (req, res) => {
  const users = await fetchUserData();
  const processed = processUsers(users);
  res.json(processed);
});
```

**❌ Avoid:**
```javascript
// Dependency on hoisting (bad practice)
processData();  // Call before declaration

function processData() {
  return 'data';
}
```

**Why:** FlowTrace uses AST transformation that converts `function` declarations to variables, which can break code that depends on hoisting. Well-structured code (functions declared before being used) works perfectly.

### Java ☕

**✅ Recommended Code:**
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

**❌ Avoid:**
- Static methods in utility classes without instantiation
- Excessive use of reflection
- Code that modifies bytecode at runtime

**Why:** FlowTrace for Java uses ByteBuddy which instruments instance methods. Standard OOP code works perfectly.

### Python 🐍

**✅ Recommended Code:**
```python
def fetch_user_data():
    return database.query("SELECT * FROM users")

def process_users(users):
    return [{"user": u, "processed": True} for u in users]

# Usage later
@app.route('/api/users')
def get_users():
    users = fetch_user_data()
    return jsonify(process_users(users))
```

**❌ Avoid:**
- Excessively nested functions within functions
- Manual modification of `sys.settrace`
- Decorators that modify function signatures

**Why:** FlowTrace uses `sys.settrace()` which works better with clearly structured code.

### Go 🔵

**✅ Recommended Code:**
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

**❌ Avoid:**
- Excessive inline anonymous functions
- Dynamically generated code
- Use of `unsafe` package

**Why:** FlowTrace uses Go AST transformation that requires clear named functions.

### Rust 🦀

**✅ Recommended Code:**
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

**❌ Avoid:**
- Complex macros that hide logic
- Extensive `unsafe` code
- Anonymous closures without annotations

**Why:** FlowTrace uses procedural macros that require explicit functions.

### .NET/C# 💜

**✅ Recommended Code:**
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

**❌ Avoid:**
- IL modification at runtime
- Excessive use of reflection
- Dynamic code with `dynamic` keyword

**Why:** FlowTrace uses Source Generators that require statically analyzable code.

### 📋 General Summary

**Universal Principles for All Languages:**

1. **Declare before use** - Functions/methods declared before being called
2. **Explicit code** - Avoid language tricks that hide execution flow
3. **Clear structure** - Logical organization with well-defined responsibilities
4. **Avoid excessive metaprogramming** - Dynamic generation makes instrumentation difficult
5. **Use standard patterns** - MVC, Clean Architecture, etc. work perfectly

**Well-structured code is code that FlowTrace can easily instrument.** If you follow best practices for your language, FlowTrace will work without issues.

---

## 🔗 Links

- **GitHub**: [Rixmerz/flowtrace-debugger](https://github.com/Rixmerz/flowtrace-debugger)
- **Issues**: [Report an issue](https://github.com/Rixmerz/flowtrace-debugger/issues)
- **Contribute**: [Pull Requests](https://github.com/Rixmerz/flowtrace-debugger/pulls)

---

## 📧 Contact

**Author**: Juan Pablo Díaz
**Email**: juanpablo516@gmail.com
**GitHub**: [@Rixmerz](https://github.com/Rixmerz)

For questions, suggestions, or collaborations, feel free to contact via email or open an issue on GitHub.

---

## 💖 Support the Project

If FlowTrace has been useful to you and you want to support its continued development, consider making a donation:

[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue.svg?logo=paypal)](https://paypal.me/Rixmerz516)

**Donations via PayPal**: [https://paypal.me/Rixmerz516](https://paypal.me/Rixmerz516)

Your support helps keep the project active and continue adding new features. Thank you! 🙏
