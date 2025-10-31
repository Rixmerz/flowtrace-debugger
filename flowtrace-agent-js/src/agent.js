/**
 * FlowTrace Agent for JavaScript/TypeScript
 * Main entry point - equivalent to FlowTraceAgent.java
 */

const Module = require('module');
const config = require('./config');
const logger = require('./logger');
const exclusions = require('./exclusions');
const instrumentation = require('./instrumentation');
const mainInstrumentor = require('./main-instrumentor');

class FlowTraceAgent {
  constructor() {
    this.originalLoad = null;
    this.installed = false;
    this.instrumentedModules = new Set();
  }

  /**
   * Install the agent (equivalent to premain() in Java)
   */
  install() {
    if (this.installed) {
      console.error('FlowTrace: Agent already installed');
      return;
    }

    console.error('FlowTrace: Installing JavaScript agent...');
    config.print();

    if (!config.enabled) {
      console.error('FlowTrace: Agent disabled by configuration');
      return;
    }

    // Hook into Node.js module loading system
    this._hookModuleLoad();

    // Hook into main module compilation to instrument entry point
    this._hookMainModule();

    // Handle TypeScript if available
    this._setupTypeScriptSupport();

    this.installed = true;
    console.error('FlowTrace: Agent installed successfully');
  }

  /**
   * Hook into Module._load to intercept module loading
   */
  _hookModuleLoad() {
    this.originalLoad = Module._load;
    const self = this;

    Module._load = function(request, parent) {
      // Call original load
      const exports = self.originalLoad.apply(this, arguments);

      // Get module path
      const modulePath = Module._resolveFilename(request, parent);

      // Check if should instrument
      if (self._shouldInstrumentModule(modulePath)) {
        // Instrument the module
        return self._instrumentModule(exports, modulePath);
      }

      return exports;
    };
  }

  /**
   * Hook into main module compilation to instrument entry point
   */
  _hookMainModule() {
    const originalCompile = Module.prototype._compile;

    // Replace Module._compile with instrumenting version
    Module.prototype._compile = mainInstrumentor.createInstrumentingCompile(originalCompile, instrumentation);
  }

  /**
   * Check if module should be instrumented
   */
  _shouldInstrumentModule(modulePath) {
    // Already instrumented
    if (this.instrumentedModules.has(modulePath)) {
      return false;
    }

    // Check exclusions
    if (exclusions.shouldExclude(modulePath)) {
      return false;
    }

    // Check package prefix filter
    if (config.packagePrefix && !config.shouldInstrument(modulePath)) {
      return false;
    }

    return true;
  }

  /**
   * Instrument a module's exports
   */
  _instrumentModule(exports, modulePath) {
    try {
      // Mark as instrumented
      this.instrumentedModules.add(modulePath);

      // Wrap the module
      const wrapped = instrumentation.wrapModule(exports, modulePath);

      return wrapped;
    } catch (error) {
      console.error(`FlowTrace: Error instrumenting ${modulePath}:`, error.message);
      return exports;
    }
  }

  /**
   * Setup TypeScript support if available
   */
  _setupTypeScriptSupport() {
    try {
      // Check if TypeScript/ts-node is available
      const tsConfigPath = require.resolve('ts-node', { paths: [process.cwd()] });

      if (tsConfigPath) {
        console.error('FlowTrace: TypeScript support detected, enabling ts-node integration');

        // Register ts-node if not already registered
        if (!process[Symbol.for('ts-node.register.instance')]) {
          require('ts-node/register');
        }
      }
    } catch (err) {
      // ts-node not available, skip TypeScript support
      // This is fine - we'll work with JavaScript only
    }
  }

  /**
   * Uninstall the agent
   */
  uninstall() {
    if (!this.installed) return;

    if (this.originalLoad) {
      Module._load = this.originalLoad;
      this.originalLoad = null;
    }

    this.instrumentedModules.clear();
    this.installed = false;

    console.error('FlowTrace: Agent uninstalled');
  }

  /**
   * Get instrumentation statistics
   */
  getStats() {
    return {
      installed: this.installed,
      instrumentedModules: this.instrumentedModules.size,
      exclusions: exclusions.getSummary(),
      config: config.toObject()
    };
  }
}

// Create singleton instance
const agent = new FlowTraceAgent();

// Auto-install when required
agent.install();

// Cleanup on exit
process.on('exit', () => {
  agent.uninstall();
  logger.close();
});

module.exports = agent;
