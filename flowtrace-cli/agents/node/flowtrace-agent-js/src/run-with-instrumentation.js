#!/usr/bin/env node

/**
 * FlowTrace Runner - Runs application with complete instrumentation
 * This ensures the main file is also instrumented
 */

// Get the application file from command line
const appFile = process.argv[2];

if (!appFile) {
  console.error('Usage: node run-with-instrumentation.js <app-file> [args...]');
  process.exit(1);
}

// Install the agent FIRST
require('./agent');

// Remove this script from argv so the app sees correct arguments
process.argv.splice(1, 1);

// Now require the application - it will be instrumented through Module._load hook
const path = require('path');
const Module = require('module');
const absolutePath = path.resolve(appFile);

console.error(`FlowTrace: Loading application: ${absolutePath}`);

// Create a new Module and set it as the main module
const mainModule = new Module(absolutePath, null);
mainModule.filename = absolutePath;
mainModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));

// Set as require.main
require.main = mainModule;
process.mainModule = mainModule;

// Load and run the module
mainModule.load(absolutePath);
