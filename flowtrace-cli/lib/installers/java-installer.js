/**
 * Java Agent Installer
 * Handles installation of FlowTrace Java agent
 */

const fs = require('fs-extra');
const path = require('path');
const ora = require('ora');
const chalk = require('chalk');
const ScriptGenerator = require('../generators/script-generator');

class JavaInstaller {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  /**
   * Install Java agent
   */
  async install(config) {
    // Step 1: Copy agent JAR
    await this.copyAgent();

    // Step 2: Create launcher script if requested
    if (config.createLauncher) {
      await this.createLauncherScript(config);
    }
  }

  /**
   * Copy agent JAR to project
   */
  async copyAgent() {
    const spinner = ora('Installing Java agent...').start();

    try {
      const sourceAgent = path.join(__dirname, '../../agents/java/flowtrace-agent.jar');
      const destDir = path.join(this.projectPath, '.flowtrace');
      const destAgent = path.join(destDir, 'flowtrace-agent.jar');

      // Ensure .flowtrace directory exists
      await fs.ensureDir(destDir);

      // Check if source agent exists, otherwise look in parent flowtrace project
      let agentSource = sourceAgent;
      if (!(await fs.pathExists(sourceAgent))) {
        // Try to find agent in parent flowtrace project
        const parentAgent = path.join(__dirname, '../../../flowtrace-agent/target/flowtrace-agent-1.0.0.jar');
        if (await fs.pathExists(parentAgent)) {
          agentSource = parentAgent;
        } else {
          spinner.fail('Java agent not found');
          throw new Error('Java agent JAR not found. Please build the agent first: cd flowtrace-agent && mvn clean package');
        }
      }

      // Copy agent
      await fs.copy(agentSource, destAgent);

      spinner.succeed('Java agent installed');
    } catch (error) {
      spinner.fail('Failed to install Java agent');
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
      await generator.generateJavaScript(config);

      spinner.succeed('Launcher script created');
    } catch (error) {
      spinner.fail('Failed to create launcher script');
      throw error;
    }
  }
}

module.exports = JavaInstaller;
