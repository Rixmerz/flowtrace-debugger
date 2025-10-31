# flowctl-dotnet - FlowTrace .NET CLI Tool

Command-line tool for analyzing C# projects and auto-instrumenting code with FlowTrace [Trace] attributes.

## Features

- ✅ **Code Analysis**: Scan C# projects for instrumentable methods
- ✅ **Auto-Instrumentation**: Automatically add [Trace] attributes to methods
- ✅ **Project Validation**: Verify FlowTrace agent setup
- ✅ **Roslyn-Based**: Uses Microsoft.CodeAnalysis for accurate C# parsing
- ✅ **Dry Run Mode**: Preview changes before applying
- ✅ **Statistics**: Detailed analysis reports and coverage metrics

## Installation

### Build from Source

```bash
cd flowctl-dotnet
dotnet build
dotnet run -- --help
```

### Create Global Tool (Optional)

```bash
dotnet pack
dotnet tool install --global --add-source ./nupkg flowctl-dotnet
```

## Commands

### 1. Analyze

Analyze C# project for instrumentable methods.

```bash
dotnet run -- analyze <path>
```

**Examples**:

```bash
# Analyze single file
dotnet run -- analyze ../examples/SimpleExample/Program.cs

# Analyze entire directory
dotnet run -- analyze ../examples

# Analyze current project
dotnet run -- analyze .
```

**Output**:

```
═══════════════════════════════════════════════
  🔍 Analyzing C# Project
═══════════════════════════════════════════════

📊 Analysis Results:
   5 files analyzed
   12 classes found
   47 total methods
   35 instrumentable methods
   12 already instrumented
   8 non-public methods
   2 generated files (skipped)

📈 Coverage: 34.3% of instrumentable methods are traced

📁 Files with instrumentable methods:
   Program.cs:
      15 methods, 12 instrumentable, 5 traced
   ProductService.cs:
      8 methods, 6 instrumentable, 2 traced

✅ Analysis complete!
```

### 2. Instrument

Add [Trace] attributes to methods in a file.

```bash
dotnet run -- instrument <file> [--dry-run]
```

**Examples**:

```bash
# Preview changes (dry run)
dotnet run -- instrument Program.cs --dry-run

# Apply instrumentation
dotnet run -- instrument Program.cs
```

**Output (Dry Run)**:

```
═══════════════════════════════════════════════
  🔍 Preview Instrumentation (Dry Run)
═══════════════════════════════════════════════

✅ Instrumented 5 methods in Program.cs

📝 Instrumented methods:
   - Calculator.Add
   - Calculator.Multiply
   - Calculator.Divide
   - Calculator.FetchDataAsync
   - ProductService.GetProductById

📋 Preview mode - no files were modified
   Run without --dry-run to apply changes
```

**Output (Applied)**:

```
═══════════════════════════════════════════════
  🔧 Instrumenting Code
═══════════════════════════════════════════════

✅ Instrumented 5 methods in Program.cs

📝 Instrumented methods:
   - Calculator.Add
   - Calculator.Multiply
   - Calculator.Divide
   - Calculator.FetchDataAsync
   - ProductService.GetProductById

💾 File updated: Program.cs

⚠️  Remember to:
   1. Add 'using Flowtrace.Agent;' if not present
   2. Make classes 'partial' for Source Generator
   3. Build project to generate traced methods
```

### 3. Validate

Validate FlowTrace agent setup in current project.

```bash
dotnet run -- validate
```

**Output**:

```
═══════════════════════════════════════════════
  🔍 Validating FlowTrace Setup
═══════════════════════════════════════════════

✅ Flowtrace.Agent package: Found
✅ C# source files: Found 47 C# files
✅ Source Generator: Found
✅ .csproj files: Found 3 project files
✅ [Trace] attribute usage: Found in source files

🎉 All checks passed! FlowTrace is properly set up.
```

**Failed Validation**:

```
❌ Flowtrace.Agent package: Not found in project references
✅ C# source files: Found 12 C# files
❌ Source Generator: Not detected
✅ .csproj files: Found 1 project files
❌ [Trace] attribute usage: Not used yet

⚠️  Some checks failed. Please review the setup.

💡 Quick setup guide:
   1. Add Flowtrace.Agent NuGet package to your project
   2. Add [Trace] attributes to methods you want to instrument
   3. Make classes 'partial' for Source Generator
   4. Build project to generate instrumented methods
```

### 4. Version

Show version information.

```bash
dotnet run -- version
```

**Output**:

```
═══════════════════════════════════════════════
  FlowTrace .NET CLI Tool
═══════════════════════════════════════════════
Version: 1.0.0
Runtime: .NET 8.0

Components:
  - Roslyn Code Analyzer
  - Auto-Instrumentation Engine
  - Project Validator

Repository: https://github.com/Rixmerz/flowtrace-debugger
Documentation: See README.md
```

## Instrumentation Rules

### Methods that ARE instrumented:

- ✅ Public methods
- ✅ Internal methods
- ✅ Async methods (Task, Task<T>)
- ✅ Methods with return values
- ✅ Void methods

### Methods that are NOT instrumented:

- ❌ Private methods
- ❌ Protected methods
- ❌ Property accessors (get/set)
- ❌ Constructors
- ❌ Operator overloads
- ❌ Methods already with [Trace]
- ❌ Methods with [TraceIgnore]
- ❌ Common methods: ToString, Equals, GetHashCode, Dispose

## Example Workflow

### Starting a New Project

```bash
# 1. Validate setup
cd MyProject
dotnet run --project ../flowctl-dotnet -- validate

# 2. Analyze current coverage
dotnet run --project ../flowctl-dotnet -- analyze .

# 3. Preview instrumentation for a file
dotnet run --project ../flowctl-dotnet -- instrument Services/ProductService.cs --dry-run

# 4. Apply instrumentation
dotnet run --project ../flowctl-dotnet -- instrument Services/ProductService.cs

# 5. Make class partial and build
# Edit ProductService.cs to add 'partial' keyword
# Run: dotnet build

# 6. Verify analysis again
dotnet run --project ../flowctl-dotnet -- analyze .
```

### Batch Instrumentation

```bash
# Instrument multiple files
for file in Services/*.cs; do
    dotnet run --project ../flowctl-dotnet -- instrument "$file"
done
```

## Code Analysis Details

### Analysis Statistics

- **Total Files**: Number of C# files analyzed (excludes obj/, bin/, *.g.cs)
- **Total Classes**: All class declarations found
- **Total Methods**: All methods across all classes
- **Instrumentable Methods**: Public/internal methods eligible for [Trace]
- **Already Instrumented**: Methods that already have [Trace] attribute
- **Non-Public Methods**: Private/protected methods (skipped)
- **Generated Files**: Auto-generated files (skipped)

### Coverage Calculation

```
Coverage = (Already Instrumented / Instrumentable Methods) × 100%
```

Example: If you have 35 instrumentable methods and 12 are traced, coverage is 34.3%.

## Roslyn Integration

### Code Analysis

Uses **Microsoft.CodeAnalysis.CSharp** for:
- Parsing C# syntax trees
- Identifying method declarations
- Checking method modifiers (public, internal, private)
- Finding existing [Trace] attributes
- Detecting [TraceIgnore] attributes

### Code Modification

Uses **CSharpSyntaxRewriter** for:
- Traversing syntax trees
- Adding [Trace] attributes to method declarations
- Preserving code formatting and comments
- Generating modified source code

### Example Transformation

**Before**:
```csharp
public class Calculator
{
    public int Add(int x, int y)
    {
        return x + y;
    }

    public async Task<string> FetchDataAsync(string url)
    {
        await Task.Delay(100);
        return $"Data from {url}";
    }
}
```

**After** (running `instrument Calculator.cs`):
```csharp
public class Calculator
{
    [Trace]
    public int Add(int x, int y)
    {
        return x + y;
    }

    [Trace]
    public async Task<string> FetchDataAsync(string url)
    {
        await Task.Delay(100);
        return $"Data from {url}";
    }
}
```

## Dependencies

### NuGet Packages

- **Microsoft.CodeAnalysis.CSharp** (4.8.0): Roslyn compiler platform for C# analysis
- **System.CommandLine** (2.0.0-beta4): Modern command-line parsing

### Runtime

- .NET 8.0 or later

## Architecture

```
flowctl-dotnet/
├── Program.cs           # CLI entry point with System.CommandLine
├── Analyzer.cs          # Roslyn-based code analysis
├── Instrumenter.cs      # Auto-instrumentation with SyntaxRewriter
├── flowctl-dotnet.csproj
└── README.md
```

### Program.cs (260 LOC)
- Command-line interface setup
- Command handlers: analyze, instrument, validate, version
- User-friendly output formatting

### Analyzer.cs (180 LOC)
- Roslyn syntax tree parsing
- Method detection and classification
- Statistics collection
- File and project analysis

### Instrumenter.cs (150 LOC)
- CSharpSyntaxRewriter implementation
- [Trace] attribute injection
- Code modification and file writing
- Dry run support

## Comparison with Other Agents

| Feature | .NET flowctl-dotnet | Python flowctl-py | Go flowctl | Rust flowctl-rs |
|---------|---------------------|-------------------|------------|-----------------|
| Technology | Roslyn (C#) | AST module (Python) | go/parser | syn crate (Rust) |
| Commands | 4 commands | 4 commands | 4 commands | 4 commands |
| Auto-Instrument | ✅ SyntaxRewriter | ✅ NodeTransformer | ✅ AST rewrite | ✅ Proc macro suggest |
| Dry Run | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Validation | ✅ Project checks | ✅ Project checks | ✅ Project checks | ✅ Project checks |
| Analysis Stats | ✅ Detailed | ✅ Detailed | ✅ Detailed | ✅ Detailed |
| LOC | ~600 | ~590 | ~650 | ~700 |

## Troubleshooting

### "Cannot instrument generated files"

**Issue**: Trying to instrument auto-generated files (*.g.cs).

**Solution**: Only instrument your own source files, not generated ones.

### "Not a C# file"

**Issue**: Trying to instrument non-.cs files.

**Solution**: Provide a valid .cs file path to the instrument command.

### "Class must be partial"

**Issue**: Source Generator requires classes to be partial.

**Solution**: After running `instrument`, manually add `partial` keyword to class declarations:

```csharp
// Before
public class ProductService

// After
public partial class ProductService
```

### Missing "using Flowtrace.Agent;"

**Issue**: [Trace] attribute not recognized after instrumentation.

**Solution**: Add the using directive at the top of the file:

```csharp
using Flowtrace.Agent;
```

## Best Practices

### 1. Start with Analysis

Always run `analyze` first to understand your project:

```bash
dotnet run -- analyze .
```

### 2. Use Dry Run

Preview changes before applying:

```bash
dotnet run -- instrument MyService.cs --dry-run
```

### 3. Instrument Incrementally

Start with critical services, not everything at once:

```bash
# Instrument core services first
dotnet run -- instrument Services/ProductService.cs
dotnet run -- instrument Services/OrderService.cs
```

### 4. Validate After Changes

Verify setup after instrumentation:

```bash
dotnet run -- validate
```

### 5. Make Classes Partial

Remember to add `partial` keyword after instrumentation for Source Generator to work.

## Future Enhancements

- [ ] Batch instrumentation command
- [ ] Remove instrumentation command
- [ ] Custom attribute configuration
- [ ] Integration with dotnet CLI as global tool
- [ ] MSBuild integration
- [ ] Visual Studio extension
- [ ] Coverage report generation
- [ ] Selective instrumentation by pattern

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](../../LICENSE) for details.
