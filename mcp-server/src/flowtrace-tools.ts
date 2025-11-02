import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

/**
 * Register FlowTrace initialization and execution tools
 */
export function registerFlowTraceTools(mcp: McpServer) {

  // Tool 1: flowtrace.init
  mcp.tool(
    "flowtrace.init",
    "Initialize FlowTrace in a project directory",
    {
      projectPath: z.string().describe("Absolute path to the project directory to initialize FlowTrace"),
      autoYes: z.boolean().optional().describe("Automatically accept all prompts during initialization (default: true)"),
      language: z.enum(["node", "java", "python"]).optional().describe("Force specific language detection: 'node', 'java', or 'python'. Auto-detected if not specified")
    },
    async ({ projectPath, autoYes = true, language }) => {
      try {
        // Check if already initialized
        const configPath = join(projectPath, ".flowtrace", "config.json");
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, "utf-8"));
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                alreadyInitialized: true,
                message: "FlowTrace is already initialized",
                config
              }, null, 2)
            }]
          };
        }

        // Run flowtrace init
        const command = autoYes ? "flowtrace init --yes" : "flowtrace init";
        const languageArg = language ? ` --language ${language}` : "";
        const fullCommand = command + languageArg;

        const { stdout, stderr } = await execAsync(fullCommand, {
          cwd: projectPath,
          timeout: 120000
        });

        // Check if initialization succeeded
        if (!existsSync(configPath)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Initialization completed but config not found",
                stdout,
                stderr
              }, null, 2)
            }]
          };
        }

        const config = JSON.parse(readFileSync(configPath, "utf-8"));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "FlowTrace initialized successfully",
              config,
              configPath,
              launcherPath: join(projectPath, "run-and-flowtrace.sh")
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );

  // Tool 2: flowtrace.detect
  mcp.tool(
    "flowtrace.detect",
    "Detect project language and framework",
    {
      projectPath: z.string().describe("Absolute path to the project directory to analyze for language and framework detection")
    },
    async ({ projectPath }) => {
      try {
        const result: any = {
          success: true,
          language: "unknown",
          framework: "unknown",
          indicators: []
        };

        // Node.js detection
        if (existsSync(join(projectPath, "package.json"))) {
          result.language = "node";
          result.indicators.push("package.json");

          const pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          if (deps["react-scripts"]) {
            result.framework = "react-cra";
            result.defaultPort = 3000;
          } else if (deps["next"]) {
            result.framework = "nextjs";
            result.defaultPort = 3000;
          } else if (deps["express"]) {
            result.framework = "express";
            result.defaultPort = 3000;
          }
        }

        // Java detection
        if (existsSync(join(projectPath, "pom.xml"))) {
          result.language = "java";
          result.framework = "maven";
          result.indicators.push("pom.xml");

          const pom = readFileSync(join(projectPath, "pom.xml"), "utf-8");
          if (pom.includes("spring-boot")) {
            result.framework = "spring-boot";
            result.defaultPort = 8080;
          }
        }

        // Python detection
        if (existsSync(join(projectPath, "requirements.txt"))) {
          result.language = "python";
          result.indicators.push("requirements.txt");

          const reqs = readFileSync(join(projectPath, "requirements.txt"), "utf-8");
          if (reqs.includes("Django")) {
            result.framework = "django";
            result.defaultPort = 8000;
          } else if (reqs.includes("fastapi")) {
            result.framework = "fastapi";
            result.defaultPort = 8000;
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );

  // Tool 3: flowtrace.build
  mcp.tool(
    "flowtrace.build",
    "Build project based on detected language",
    {
      projectPath: z.string().describe("Absolute path to the project directory to build"),
      clean: z.boolean().optional().describe("Perform clean build (removes previous build artifacts). Default: true for Java (mvn clean), ignored for Node/Python")
    },
    async ({ projectPath, clean = true }) => {
      try {
        let buildCommand = "";
        let language = "unknown";

        // Detect language and build command
        if (existsSync(join(projectPath, "package.json"))) {
          language = "node";
          buildCommand = "npm install";
        } else if (existsSync(join(projectPath, "pom.xml"))) {
          language = "java";
          buildCommand = clean ? "mvn clean package" : "mvn package";
        } else if (existsSync(join(projectPath, "requirements.txt"))) {
          language = "python";
          buildCommand = "pip install -r requirements.txt";
        }

        if (!buildCommand) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Unable to detect project type"
              }, null, 2)
            }]
          };
        }

        const { stdout, stderr } = await execAsync(buildCommand, {
          cwd: projectPath,
          timeout: 600000 // 10 minutes
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              language,
              buildCommand,
              stdout,
              stderr
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );

  // Tool 4: flowtrace.execute
  mcp.tool(
    "flowtrace.execute",
    "Execute application with FlowTrace instrumentation",
    {
      projectPath: z.string().describe("Absolute path to the project directory containing run-and-flowtrace.sh launcher script"),
      timeout: z.number().optional().describe("Execution timeout in seconds (default: 60). Process will be terminated after this duration")
    },
    async ({ projectPath, timeout = 60 }) => {
      try {
        const scriptPath = join(projectPath, "run-and-flowtrace.sh");

        if (!existsSync(scriptPath)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "run-and-flowtrace.sh not found. Run flowtrace.init first."
              }, null, 2)
            }]
          };
        }

        // Execute in background
        const { stdout, stderr } = await execAsync(`bash ${scriptPath} &`, {
          cwd: projectPath,
          timeout: timeout * 1000
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Application started with FlowTrace instrumentation",
              stdout,
              stderr
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );

  // Tool 5: flowtrace.cleanup
  mcp.tool(
    "flowtrace.cleanup",
    "Clean FlowTrace log files",
    {
      projectPath: z.string().describe("Absolute path to the project directory containing FlowTrace log files to clean"),
      cleanMain: z.boolean().optional().describe("Clean the main flowtrace.jsonl log file (default: true)"),
      cleanTruncated: z.boolean().optional().describe("Clean all truncated log files in flowtrace-jsonsl/ directory (default: true)")
    },
    async ({ projectPath, cleanMain = true, cleanTruncated = true }) => {
      try {
        let filesDeleted = [];
        let bytesFreed = 0;

        // Clean main log
        if (cleanMain) {
          const mainLog = join(projectPath, "flowtrace.jsonl");
          if (existsSync(mainLog)) {
            const size = statSync(mainLog).size;
            writeFileSync(mainLog, "");
            filesDeleted.push("flowtrace.jsonl");
            bytesFreed += size;
          }
        }

        // Clean truncated logs
        if (cleanTruncated) {
          const truncatedDir = join(projectPath, "flowtrace-jsonsl");
          if (existsSync(truncatedDir)) {
            const files = readdirSync(truncatedDir);
            for (const file of files) {
              const filePath = join(truncatedDir, file);
              const size = statSync(filePath).size;
              unlinkSync(filePath);
              filesDeleted.push(`flowtrace-jsonsl/${file}`);
              bytesFreed += size;
            }
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              filesDeleted,
              bytesFreed,
              bytesFreedMB: (bytesFreed / (1024 * 1024)).toFixed(2)
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );

  // Tool 6: flowtrace.status
  mcp.tool(
    "flowtrace.status",
    "Get FlowTrace project status",
    {
      projectPath: z.string().describe("Absolute path to the project directory to check FlowTrace initialization and log status")
    },
    async ({ projectPath }) => {
      try {
        const result: any = {
          success: true,
          initialized: false,
          logs: {
            mainLogExists: false,
            mainLogSize: 0,
            truncatedLogCount: 0
          }
        };

        // Check initialization
        const configPath = join(projectPath, ".flowtrace", "config.json");
        if (existsSync(configPath)) {
          result.initialized = true;
          result.config = JSON.parse(readFileSync(configPath, "utf-8"));
        }

        // Check logs
        const mainLog = join(projectPath, "flowtrace.jsonl");
        if (existsSync(mainLog)) {
          result.logs.mainLogExists = true;
          result.logs.mainLogSize = statSync(mainLog).size;
        }

        const truncatedDir = join(projectPath, "flowtrace-jsonsl");
        if (existsSync(truncatedDir)) {
          result.logs.truncatedLogCount = readdirSync(truncatedDir).length;
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
    }
  );
}
