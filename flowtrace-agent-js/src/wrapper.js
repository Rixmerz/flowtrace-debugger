/**
 * FlowTrace Wrapper for Entry Point Files
 * This wrapper ensures the entry point file is instrumented
 */

const path = require('path');
const Module = require('module');
const fs = require('fs');

const config = require('./config');
const logger = require('./logger');
const instrumentation = require('./instrumentation');
const exclusions = require('./exclusions');

/**
 * Load and instrument the main application file
 */
function loadMainFile(mainFilePath) {
  // Resolve absolute path
  const absolutePath = path.resolve(mainFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Main file not found: ${absolutePath}`);
  }

  console.error(`FlowTrace: Instrumenting main file: ${absolutePath}`);

  // Read the file
  const originalCode = fs.readFileSync(absolutePath, 'utf-8');

  // Create a new module
  const mainModule = new Module(absolutePath, module.parent);
  mainModule.filename = absolutePath;
  mainModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));

  // Check if should instrument
  if (exclusions.shouldExclude(absolutePath) ||
      (config.packagePrefix && !config.shouldInstrument(absolutePath))) {
    console.error('FlowTrace: Main file excluded from instrumentation');
    mainModule._compile(originalCode, absolutePath);
    return mainModule.exports;
  }

  // Compile the module
  mainModule._compile(originalCode, absolutePath);

  // Get the module's exports
  let exports = mainModule.exports;

  // Instrument the exports
  const moduleName = path.basename(absolutePath, path.extname(absolutePath));

  if (typeof exports === 'function') {
    // Single function export
    exports = instrumentation.wrapFunction(exports, moduleName, exports.name || 'default');
  } else if (typeof exports === 'object' && exports !== null) {
    // Object with multiple exports
    for (const key in exports) {
      if (!exports.hasOwnProperty(key)) continue;
      if (exclusions.shouldExcludeProperty(key)) continue;

      const value = exports[key];

      if (typeof value === 'function') {
        exports[key] = instrumentation.wrapFunction(value, moduleName, key);
      } else if (value && value.constructor && value.constructor !== Object) {
        exports[key] = instrumentation.wrapClass(value, moduleName);
      }
    }
  }

  // Also instrument any global functions defined in the module scope
  // This requires accessing the module's context, which is complex
  // For now, we focus on exported functions

  console.error(`FlowTrace: Main file instrumented successfully`);

  return exports;
}

module.exports = { loadMainFile };
