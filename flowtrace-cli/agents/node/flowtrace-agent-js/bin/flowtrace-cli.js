#!/usr/bin/env node

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
