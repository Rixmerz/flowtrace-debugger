/**
 * Run Command - Run application with FlowTrace
 */

const { spawn } = require('child_process');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

async function runCommand(script, options) {
  const projectPath = process.cwd();
  const configPath = path.join(projectPath, '.flowtrace/config.json');

  if (!(await fs.pathExists(configPath))) {
    console.error(chalk.red('Error: FlowTrace not initialized'));
    console.log(chalk.gray('Run: flowtrace init'));
    process.exit(1);
  }

  const config = await fs.readJson(configPath);

  // Determine launcher script
  const launcherScript = config.launcher?.script || 'run-and-flowtrace.sh';
  const launcherPath = path.join(projectPath, launcherScript);

  if (!(await fs.pathExists(launcherPath))) {
    console.error(chalk.red(`Error: Launcher script not found: ${launcherScript}`));
    console.log(chalk.gray('Run: flowtrace init'));
    process.exit(1);
  }

  console.log(chalk.cyan(`Running with FlowTrace: ${launcherScript}`));
  console.log();

  // Set debug flag if requested
  if (options.debug) {
    process.env.FLOWTRACE_STDOUT = 'true';
  }

  // Execute launcher script
  const shell = config.launcher?.shell === 'powershell' ? 'powershell.exe' : 'bash';
  const args = script ? [launcherPath, script] : [launcherPath];

  const child = spawn(shell, args, {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

module.exports = runCommand;
