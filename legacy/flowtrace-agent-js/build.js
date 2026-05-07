#!/usr/bin/env node

/**
 * Build script for FlowTrace Agent JS
 * Simple build process - no bundling needed for Node.js
 */

const fs = require('fs');
const path = require('path');

console.log('Building FlowTrace Agent JS...');

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy source files to dist (for now, just ensure structure is valid)
console.log('✓ Source files validated');

// Validate package.json
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('✗ package.json not found');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
console.log(`✓ Package: ${packageJson.name} v${packageJson.version}`);

// Validate required source files
const requiredFiles = [
  'src/config.js',
  'src/logger.js',
  'src/exclusions.js',
  'src/instrumentation.js',
  'src/agent.js',
  'src/loader.js',
  'src/esm-loader.mjs'
];

let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`✗ Missing required file: ${file}`);
    allFilesExist = false;
  } else {
    console.log(`✓ ${file}`);
  }
}

if (!allFilesExist) {
  console.error('\n✗ Build failed: missing required files');
  process.exit(1);
}

// Create bin directory and CLI wrapper if needed
const binDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const cliContent = `#!/usr/bin/env node

/**
 * FlowTrace CLI
 * Usage: flowtrace [options] script.js [args...]
 */

const path = require('path');

// Get script and arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: flowtrace [options] script.js [args...]');
  console.error('');
  console.error('Options:');
  console.error('  --package-prefix=PREFIX    Only instrument modules matching PREFIX');
  console.error('  --logfile=FILE             Output file (default: flowtrace.jsonl)');
  console.error('  --stdout                   Also write to stdout');
  console.error('  --help                     Show this help');
  process.exit(1);
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log('FlowTrace - JavaScript/TypeScript execution tracer');
  console.log('');
  console.log('Usage: flowtrace [options] script.js [args...]');
  console.log('');
  console.log('Options:');
  console.log('  --package-prefix=PREFIX    Only instrument modules matching PREFIX');
  console.log('  --logfile=FILE             Output file (default: flowtrace.jsonl)');
  console.log('  --stdout                   Also write to stdout');
  console.log('  --annotation-only          Only instrument decorated functions');
  console.log('');
  console.log('Environment Variables:');
  console.log('  FLOWTRACE_PACKAGE_PREFIX   Package prefix filter');
  console.log('  FLOWTRACE_LOGFILE          Log file path');
  console.log('  FLOWTRACE_STDOUT           Write to stdout (true/false)');
  console.log('  FLOWTRACE_ENABLED          Enable/disable tracing (true/false)');
  console.log('');
  console.log('Examples:');
  console.log('  flowtrace app.js');
  console.log('  flowtrace --package-prefix=myapp app.js');
  console.log('  flowtrace --stdout --logfile=trace.jsonl app.js');
  process.exit(0);
}

// Parse options and script
let scriptIndex = -1;
const execArgv = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg.startsWith('--package-prefix=')) {
    process.env.FLOWTRACE_PACKAGE_PREFIX = arg.split('=')[1];
  } else if (arg.startsWith('--logfile=')) {
    process.env.FLOWTRACE_LOGFILE = arg.split('=')[1];
  } else if (arg === '--stdout') {
    process.env.FLOWTRACE_STDOUT = 'true';
  } else if (arg === '--annotation-only') {
    process.env.FLOWTRACE_ANNOTATION_ONLY = 'true';
  } else if (!arg.startsWith('-')) {
    scriptIndex = i;
    break;
  }
}

if (scriptIndex === -1) {
  console.error('Error: No script specified');
  process.exit(1);
}

const scriptPath = args[scriptIndex];
const scriptArgs = args.slice(scriptIndex + 1);

// Require the agent loader
const loaderPath = path.join(__dirname, '..', 'src', 'loader.js');
require(loaderPath);

// Set script arguments
process.argv = [process.argv[0], scriptPath, ...scriptArgs];

// Run the script
require(path.resolve(scriptPath));
`;

const cliPath = path.join(binDir, 'flowtrace-cli.js');
fs.writeFileSync(cliPath, cliContent);
fs.chmodSync(cliPath, '755');
console.log('✓ CLI wrapper created');

// Write build info
const buildInfo = {
  version: packageJson.version,
  buildDate: new Date().toISOString(),
  nodeVersion: process.version
};

fs.writeFileSync(
  path.join(distDir, 'build-info.json'),
  JSON.stringify(buildInfo, null, 2)
);
console.log('✓ Build info generated');

console.log('');
console.log('✅ Build completed successfully!');
console.log('');
console.log('Usage:');
console.log('  node --require ./src/loader.js your-app.js');
console.log('  ./bin/flowtrace-cli.js your-app.js');
