using System.CommandLine;

namespace FlowctlDotnet;

/// <summary>
/// FlowTrace .NET CLI Tool - Code analysis and auto-instrumentation for C# projects.
/// </summary>
class Program
{
    static async Task<int> Main(string[] args)
    {
        var rootCommand = new RootCommand("flowctl-dotnet - FlowTrace .NET Agent CLI Tool");

        // Analyze command
        var analyzeCommand = new Command("analyze", "Analyze C# project for instrumentable methods");
        var analyzePathArg = new Argument<string>("path", "Path to analyze (file or directory)");
        analyzeCommand.AddArgument(analyzePathArg);
        analyzeCommand.SetHandler((string path) => AnalyzeCommand(path), analyzePathArg);

        // Instrument command
        var instrumentCommand = new Command("instrument", "Add [Trace] attributes to methods");
        var instrumentPathArg = new Argument<string>("path", "Path to file to instrument");
        var dryRunOption = new Option<bool>("--dry-run", "Preview changes without modifying files");
        instrumentCommand.AddArgument(instrumentPathArg);
        instrumentCommand.AddOption(dryRunOption);
        instrumentCommand.SetHandler((string path, bool dryRun) => InstrumentCommand(path, dryRun),
            instrumentPathArg, dryRunOption);

        // Validate command
        var validateCommand = new Command("validate", "Validate FlowTrace agent setup");
        validateCommand.SetHandler(() => ValidateCommand());

        // Version command
        var versionCommand = new Command("version", "Show version information");
        versionCommand.SetHandler(() => VersionCommand());

        rootCommand.AddCommand(analyzeCommand);
        rootCommand.AddCommand(instrumentCommand);
        rootCommand.AddCommand(validateCommand);
        rootCommand.AddCommand(versionCommand);

        return await rootCommand.InvokeAsync(args);
    }

    static void AnalyzeCommand(string path)
    {
        PrintHeader("🔍 Analyzing C# Project");

        if (!Path.Exists(path))
        {
            Console.WriteLine($"❌ Error: Path not found: {path}");
            return;
        }

        var analyzer = new Analyzer();
        var stats = analyzer.AnalyzePath(path);

        Console.WriteLine("\n📊 Analysis Results:");
        Console.WriteLine($"   {stats.TotalFiles} files analyzed");
        Console.WriteLine($"   {stats.TotalClasses} classes found");
        Console.WriteLine($"   {stats.TotalMethods} total methods");
        Console.WriteLine($"   {stats.InstrumentableMethods} instrumentable methods");
        Console.WriteLine($"   {stats.AlreadyInstrumented} already instrumented");
        Console.WriteLine($"   {stats.NonPublicMethods} non-public methods");
        Console.WriteLine($"   {stats.GeneratedFiles} generated files (skipped)");

        if (stats.InstrumentableMethods > 0)
        {
            var percentage = (double)stats.AlreadyInstrumented / stats.InstrumentableMethods * 100;
            Console.WriteLine($"\n📈 Coverage: {percentage:F1}% of instrumentable methods are traced");
        }

        if (stats.FileDetails.Any())
        {
            Console.WriteLine("\n📁 Files with instrumentable methods:");
            foreach (var file in stats.FileDetails.OrderByDescending(f => f.InstrumentableMethods).Take(10))
            {
                Console.WriteLine($"   {file.FileName}:");
                Console.WriteLine($"      {file.TotalMethods} methods, {file.InstrumentableMethods} instrumentable, {file.AlreadyInstrumented} traced");
            }
        }

        Console.WriteLine("\n✅ Analysis complete!");
    }

    static void InstrumentCommand(string path, bool dryRun)
    {
        PrintHeader(dryRun ? "🔍 Preview Instrumentation (Dry Run)" : "🔧 Instrumenting Code");

        if (!File.Exists(path))
        {
            Console.WriteLine($"❌ Error: File not found: {path}");
            return;
        }

        if (!path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine($"❌ Error: Not a C# file: {path}");
            return;
        }

        var instrumenter = new Instrumenter();
        var result = instrumenter.InstrumentFile(path, dryRun);

        if (result.Success)
        {
            Console.WriteLine($"\n✅ Instrumented {result.MethodsInstrumented} methods in {Path.GetFileName(path)}");

            if (result.MethodsInstrumented > 0)
            {
                Console.WriteLine("\n📝 Instrumented methods:");
                foreach (var method in result.InstrumentedMethods)
                {
                    Console.WriteLine($"   - {method}");
                }

                if (!dryRun)
                {
                    Console.WriteLine($"\n💾 File updated: {path}");
                    Console.WriteLine("\n⚠️  Remember to:");
                    Console.WriteLine("   1. Add 'using Flowtrace.Agent;' if not present");
                    Console.WriteLine("   2. Make classes 'partial' for Source Generator");
                    Console.WriteLine("   3. Build project to generate traced methods");
                }
                else
                {
                    Console.WriteLine("\n📋 Preview mode - no files were modified");
                    Console.WriteLine("   Run without --dry-run to apply changes");
                }
            }
            else
            {
                Console.WriteLine("\n✅ No methods needed instrumentation");
            }
        }
        else
        {
            Console.WriteLine($"\n❌ Error: {result.ErrorMessage}");
        }
    }

    static void ValidateCommand()
    {
        PrintHeader("🔍 Validating FlowTrace Setup");

        var checks = new List<(string Name, bool Passed, string Message)>();

        // Check 1: Flowtrace.Agent package
        var agentExists = Directory.Exists("Flowtrace.Agent") ||
                         File.Exists("Flowtrace.Agent.csproj") ||
                         Directory.GetFiles(".", "*.csproj", SearchOption.AllDirectories)
                             .Any(f => File.ReadAllText(f).Contains("Flowtrace.Agent"));
        checks.Add(("Flowtrace.Agent package", agentExists,
            agentExists ? "Found" : "Not found in project references"));

        // Check 2: C# files
        var csFiles = Directory.GetFiles(".", "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains("obj") && !f.Contains("bin")).ToList();
        checks.Add(("C# source files", csFiles.Any(),
            csFiles.Any() ? $"Found {csFiles.Count} C# files" : "No C# files found"));

        // Check 3: Source Generator
        var generatorExists = Directory.Exists("Flowtrace.Agent.SourceGenerator") ||
                             csFiles.Any(f => File.ReadAllText(f).Contains("ISourceGenerator"));
        checks.Add(("Source Generator", generatorExists,
            generatorExists ? "Found" : "Not detected"));

        // Check 4: Project files
        var csprojFiles = Directory.GetFiles(".", "*.csproj", SearchOption.AllDirectories);
        checks.Add((".csproj files", csprojFiles.Any(),
            csprojFiles.Any() ? $"Found {csprojFiles.Length} project files" : "No project files found"));

        // Check 5: [Trace] usage
        var traceUsage = csFiles.Any(f => File.ReadAllText(f).Contains("[Trace]"));
        checks.Add(("[Trace] attribute usage", traceUsage,
            traceUsage ? "Found in source files" : "Not used yet"));

        // Print results
        Console.WriteLine();
        foreach (var (name, passed, message) in checks)
        {
            var icon = passed ? "✅" : "❌";
            Console.WriteLine($"{icon} {name}: {message}");
        }

        var allPassed = checks.All(c => c.Passed);
        Console.WriteLine();
        if (allPassed)
        {
            Console.WriteLine("🎉 All checks passed! FlowTrace is properly set up.");
        }
        else
        {
            Console.WriteLine("⚠️  Some checks failed. Please review the setup.");
            Console.WriteLine("\n💡 Quick setup guide:");
            Console.WriteLine("   1. Add Flowtrace.Agent NuGet package to your project");
            Console.WriteLine("   2. Add [Trace] attributes to methods you want to instrument");
            Console.WriteLine("   3. Make classes 'partial' for Source Generator");
            Console.WriteLine("   4. Build project to generate instrumented methods");
        }
    }

    static void VersionCommand()
    {
        PrintHeader("FlowTrace .NET CLI Tool");
        Console.WriteLine("Version: 1.0.0");
        Console.WriteLine("Runtime: .NET 8.0");
        Console.WriteLine();
        Console.WriteLine("Components:");
        Console.WriteLine("  - Roslyn Code Analyzer");
        Console.WriteLine("  - Auto-Instrumentation Engine");
        Console.WriteLine("  - Project Validator");
        Console.WriteLine();
        Console.WriteLine("Repository: https://github.com/Rixmerz/flowtrace-debugger");
        Console.WriteLine("Documentation: See README.md");
    }

    static void PrintHeader(string title)
    {
        Console.WriteLine();
        Console.WriteLine("═══════════════════════════════════════════════");
        Console.WriteLine($"  {title}");
        Console.WriteLine("═══════════════════════════════════════════════");
    }
}
