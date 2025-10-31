/**
 * Status Command - Show FlowTrace installation status
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

async function statusCommand() {
  console.log(chalk.bold.cyan('\n📊 FlowTrace Status\n'));

  const projectPath = process.cwd();

  // Check CLI version
  const packageJson = require('../../package.json');
  console.log(chalk.gray('CLI:'));
  console.log(`  Version: ${chalk.green(packageJson.version)}`);
  console.log();

  // Check for .flowtrace directory
  const flowtracePath = path.join(projectPath, '.flowtrace');
  const configPath = path.join(flowtracePath, 'config.json');

  if (await fs.pathExists(configPath)) {
    console.log(chalk.gray('Project Configuration:'));

    const config = await fs.readJson(configPath);
    console.log(`  Language: ${chalk.green(config.language)}`);
    console.log(`  Package Prefix: ${chalk.green(config.packagePrefix || '(all)')}`);
    console.log(`  Framework: ${chalk.green(config.framework)}`);
    console.log(`  Log File: ${chalk.green(config.logFile)}`);
    console.log();

    // Check agent installation
    const javaAgent = path.join(flowtracePath, 'flowtrace-agent.jar');
    const nodeAgent = path.join(flowtracePath, 'flowtrace-agent-js');

    console.log(chalk.gray('Installed Agents:'));

    if (await fs.pathExists(javaAgent)) {
      console.log(`  ✓ Java agent: ${chalk.green('installed')}`);
    }

    if (await fs.pathExists(nodeAgent)) {
      console.log(`  ✓ Node.js agent: ${chalk.green('installed')}`);
    }

    console.log();

    // Check for launcher script
    const launcherScript = config.launcher?.script;
    if (launcherScript) {
      const launcherPath = path.join(projectPath, launcherScript);
      if (await fs.pathExists(launcherPath)) {
        console.log(chalk.gray('Launcher Script:'));
        console.log(`  ✓ ${chalk.green(launcherScript)}`);
      }
    }
  } else {
    console.log(chalk.yellow('⚠️  FlowTrace not initialized in this project'));
    console.log(chalk.gray('  Run: flowtrace init'));
  }

  console.log();
}

module.exports = statusCommand;
