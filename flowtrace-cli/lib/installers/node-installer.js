/**
 * Node.js Agent Installer
 * Handles installation of FlowTrace Node.js agent
 */

const fs = require('fs-extra');
const path = require('path');
const ora = require('ora');
const chalk = require('chalk');
const ScriptGenerator = require('../generators/script-generator');

class NodeInstaller {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  /**
   * Install Node.js agent
   */
  async install(config) {
    // Step 1: Copy agent
    await this.copyAgent();

    // Step 2: Add npm scripts
    await this.addNpmScripts(config);

    // Step 3: Create launcher script if requested
    if (config.createLauncher) {
      await this.createLauncherScript(config);
    }
  }

  /**
   * Copy agent to project
   */
  async copyAgent() {
    const spinner = ora('Installing Node.js agent...').start();

    try {
      const sourceAgent = path.join(__dirname, '../../agents/node/flowtrace-agent-js');
      const destDir = path.join(this.projectPath, '.flowtrace');
      const destAgent = path.join(destDir, 'flowtrace-agent-js');

      // Ensure .flowtrace directory exists
      await fs.ensureDir(destDir);

      // Check if source agent exists, otherwise look in parent flowtrace project
      let agentSource = sourceAgent;
      if (!(await fs.pathExists(sourceAgent))) {
        // Try to find agent in parent flowtrace project
        const parentAgent = path.join(__dirname, '../../../flowtrace-agent-js');
        if (await fs.pathExists(parentAgent)) {
          agentSource = parentAgent;
        } else {
          spinner.fail('Node.js agent not found');
          throw new Error('Node.js agent not found. Please ensure flowtrace-agent-js directory exists');
        }
      }

      // Copy agent
      await fs.copy(agentSource, destAgent);

      spinner.succeed('Node.js agent installed');
    } catch (error) {
      spinner.fail('Failed to install Node.js agent');
      throw error;
    }
  }

  /**
   * Add npm scripts to package.json
   */
  async addNpmScripts(config) {
    const spinner = ora('Adding npm scripts...').start();

    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');

      if (!(await fs.pathExists(packageJsonPath))) {
        spinner.warn('No package.json found, skipping npm scripts');
        return;
      }

      const packageJson = await fs.readJson(packageJsonPath);

      // Ensure scripts object exists
      packageJson.scripts = packageJson.scripts || {};

      // Add trace scripts
      const loaderPath = '.flowtrace/flowtrace-agent-js/src/loader.js';
      const entryPoint = config.entryPoint || 'index.js';

      packageJson.scripts.trace = `node --require ${loaderPath} ${entryPoint}`;
      packageJson.scripts['trace:debug'] = `FLOWTRACE_STDOUT=true node --require ${loaderPath} ${entryPoint}`;
      packageJson.scripts['trace:filter'] = `FLOWTRACE_PACKAGE_PREFIX=${config.packagePrefix} node --require ${loaderPath} ${entryPoint}`;

      // Write back
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

      spinner.succeed('npm scripts added');
    } catch (error) {
      spinner.fail('Failed to add npm scripts');
      throw error;
    }
  }

  /**
   * Create launcher script
   */
  async createLauncherScript(config) {
    const spinner = ora('Creating launcher script...').start();

    try {
      const generator = new ScriptGenerator(this.projectPath);
      await generator.generateNodeScript(config);

      spinner.succeed('Launcher script created');
    } catch (error) {
      spinner.fail('Failed to create launcher script');
      throw error;
    }
  }
}

module.exports = NodeInstaller;
