// The single source of truth for what FlowTrace supports.
//
// This module exists because the same capability question had four different
// answers in this repo at once: README.en.md listed four runtimes, README.md
// listed five, CLAUDE.md said Go had been removed, and plugin/commands/trace.md
// detected go.mod and required 1.24+. An agent asked to trace a Go service
// picked whichever it happened to read and wrote a spec against it.
//
// Reference data belongs in one place an agent can query, not in four prose
// files that drift independently. Served as the `flowtrace://runtimes` MCP
// resource; the READMEs and the skill restate it, and the drift is now visible
// as a diff on this file.

export interface RuntimeSupport {
  /** `lang` as it appears in the emitted events. */
  lang: string;
  label: string;
  /** Minimum version FlowTrace can instrument. */
  minVersion: string;
  /** How the capture layer attaches. */
  mechanism: string;
  /** Shell invocation through the CLI. */
  invoke: string;
  /** How the package/module prefix is detected. Without one the trace explodes. */
  prefix: string;
  /** Does the runtime adopt a caller's traceparent on its own? */
  inbound: string;
  /** Does it attach traceparent to outgoing calls on its own? */
  outbound: string;
  notes?: string;
}

export const RUNTIMES: RuntimeSupport[] = [
  {
    lang: "java",
    label: "Java",
    minVersion: "11+ (bytecode target; CI covers JDK 17, 21, 25)",
    mechanism: "OpenTelemetry javaagent extension (ByteBuddy advice)",
    invoke: "flowtrace run -- java -jar myapp.jar",
    prefix: "groupId from pom.xml, or group from build.gradle",
    inbound: "automatic — OTel context, plus FLOWTRACE_TRACEPARENT / -Dflowtrace.traceparent",
    outbound: "automatic across the frameworks the OTel agent instruments",
    notes:
      "The OTel agent version decides which JDKs can be instrumented — its bundled ByteBuddy must know the class file version.",
  },
  {
    lang: "python",
    label: "Python",
    minVersion: "3.8+",
    mechanism: "sitecustomize bootstrap + sys.meta_path import hook, AST rewrite at import",
    invoke: "flowtrace run -- python myapp.py",
    prefix: "name from pyproject.toml / setup.py (the import name, not the distribution name)",
    inbound:
      "FLOWTRACE_TRACEPARENT only. An inbound HTTP header is NOT adopted automatically — wrap the request in flowtrace_runtime.remote_context(header) yourself. Note that import only resolves under `flowtrace run`, so guard it if the same code also runs uninstrumented.",
    outbound: "manual — flowtrace_runtime.current_traceparent()",
  },
  {
    lang: "node",
    label: "Node.js",
    minVersion: "20.6+",
    mechanism: "CJS Module._load hook + ESM loader + SWC transform; AsyncLocalStorage for context",
    invoke: "flowtrace run -- node myapp.js",
    prefix: "name from package.json (drop any @scope/)",
    inbound:
      "automatic — the HTTP server edge is patched (http.Server.prototype.emit, so express/fastify/koa/plain http and https all adopt an inbound traceparent), plus FLOWTRACE_TRACEPARENT",
    outbound: "automatic — patches global fetch and http/https.request (opt out with FLOWTRACE_PROPAGATE=0)",
  },
  {
    lang: "ts",
    label: "TypeScript",
    minVersion: "5+ (on Node 20.6+)",
    mechanism: "the same Node loaders — TypeScript is transformed on the same path, not a separate layer",
    invoke: "flowtrace run -- ts-node myapp.ts",
    prefix: "name from package.json (drop any @scope/)",
    inbound: "automatic — same as Node",
    outbound: "automatic — same as Node",
  },
  {
    lang: "go",
    label: "Go",
    minVersion: "1.24+",
    mechanism:
      "source rewrite before compilation via `go build -overlay`; the runtime is injected as <module>/internal/flowtracert. Your source tree is never written to.",
    invoke: "flowtrace run -- go run ./cmd/api   (go build and go test work too)",
    prefix: "the module line from go.mod",
    inbound:
      "automatic — any func(http.ResponseWriter, *http.Request) is seeded from the inbound traceparent by the transformer, plus FLOWTRACE_TRACEPARENT. You write no code: flowtracert only exists during an instrumented build, so calling it from your own source would break a plain `go build`.",
    outbound:
      "manual, and only from code that is itself instrumented — there is no seam to patch, since net/http resolves at compile time",
    notes:
      "The target module's own `go` directive must be 1.24+ as well; FlowTrace refuses before touching anything otherwise. Go has no seam for automatic outbound propagation: net/http resolves at compile time.",
  },
];

/** Not a general-purpose runtime — deliberately narrower, and easy to mistake for one. */
export const BROWSER_NOTE =
  "capture/browser is a fourth, deliberately narrower layer. With no AsyncLocalStorage in a browser there is no ambient async context, so it does NOT instrument every function: it records HTTP, navigation and errors, and ships them to the dashboard collector (POST /api/trace) rather than to a file. Do not describe it as browser support for tracing arbitrary code. INSTALL: `npm i @rixmerz/flowtrace-browser` — it is the one capture layer published on its own, imported as `@rixmerz/flowtrace-browser` and `@rixmerz/flowtrace-browser/angular`, and it ships TypeScript declarations. There is no `flowtrace init` path for it; wiring is by hand. CROSS-ORIGIN: `traceparent` is not a CORS-safelisted header, so the Angular interceptor turns a simple request into a preflighted one. The API must send `Access-Control-Allow-Headers: Content-Type, traceparent` or the preflight fails and the request never happens — enabling the browser layer then looks like it broke the app. Check this first when browser spans do not correlate with server spans, or when instrumenting a frontend produces CORS errors.";

export const OUTPUT_NOTE =
  "`flowtrace run` writes .flowtrace/<timestamp>.jsonl in the working directory and adds .flowtrace/ to the project's .gitignore. It prints the path on startup. `flowtrace.jsonl` is only the default when a capture layer is wired by hand.";

export const CLI_NOTE =
  "Two published npm packages, and the split is deliberate. (1) @rixmerz/flowtrace — the CLI. It vendors the Java, Node, Python and Go capture layers, so no Maven and no pip: the CLI launches the runtime and injects the layer into it. Zero-install: npx @rixmerz/flowtrace run -- <cmd>. The Claude Code plugin also puts `flowtrace` on PATH. (2) @rixmerz/flowtrace-browser — the browser capture layer, published separately because it is a build-time dependency of the application's own bundle and no global CLI install can inject a module into someone's bundler graph; reaching it through the CLI tarball would cost a frontend 31MB of @swc/core and a 2.3MB Java jar for 60KB of code. @flowtrace/cli, @flowtrace/capture-node, @flowtrace/mcp-server and flowtrace-dashboard are NOT on npm — they are workspace-internal names; installing them will 404. @flowtrace/capture-browser is the browser layer's FORMER internal name and will also 404; it is @rixmerz/flowtrace-browser now.";

/** Renders the resource body. Markdown, because the consumer is a language model. */
export function renderRuntimes(): string {
  const lines: string[] = [
    "# FlowTrace — supported runtimes",
    "",
    "Authoritative. If a README, skill or command file disagrees with this, this wins and that file is stale.",
    "",
    "| Runtime | `lang` | Minimum | Invoke | Prefix source |",
    "|---|---|---|---|---|",
  ];
  for (const r of RUNTIMES) {
    lines.push(`| ${r.label} | \`${r.lang}\` | ${r.minVersion} | \`${r.invoke}\` | ${r.prefix} |`);
  }

  lines.push(
    "",
    "A package/module prefix is mandatory in practice: without one every layer instruments frameworks and stdlib and the trace becomes unreadable. An empty trace is almost always a wrong prefix, not a bug in the application.",
    "",
    "## Capture mechanism",
    ""
  );
  for (const r of RUNTIMES) {
    lines.push(`- **${r.label}** — ${r.mechanism}${r.notes ? ` ${r.notes}` : ""}`);
  }

  lines.push(
    "",
    "## Cross-process (distributed) tracing",
    "",
    "The ids are W3C Trace Context compatible, so one logical request keeps a single `trace_id` across a process hop and every hop reads as one tree. Asserted by capture/node/test/test-cross-process.mjs (two real processes) and verified by hand on a browser -> Node -> Java -> Go chain, where all three service traces carried the browser's trace_id.",
    "",
    "**A split trace looks exactly like a working trace** until you check the ids, so verify rather than assume: collect each process's file and confirm they share one `trace_id`. Two different ids mean a hop dropped the header — that is the finding.",
    "",
    "| Runtime | Inbound (adopts the caller's trace) | Outbound (propagates onward) |",
    "|---|---|---|"
  );
  for (const r of RUNTIMES) {
    lines.push(`| ${r.label} | ${r.inbound} | ${r.outbound} |`);
  }

  lines.push(
    "",
    "To chain processes with no HTTP in between, export `FLOWTRACE_TRACEPARENT=00-<32 hex trace>-<16 hex span>-01` before launching the child; every runtime above reads it.",
    "",
    "## Output",
    "",
    OUTPUT_NOTE,
    "",
    "## Installing",
    "",
    CLI_NOTE,
    "",
    "## Browser",
    "",
    BROWSER_NOTE,
    ""
  );
  return lines.join("\n");
}
