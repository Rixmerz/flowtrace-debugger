#!/usr/bin/env node

/**
 * FlowTrace CLI - Universal installer and project manager
 * Supports Java and Node.js projects with interactive TUI
 */

const { program } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

// Set program metadata
program
  .name('flowtrace')
  .description('FlowTrace installer and project manager for Java and Node.js')
  .version(packageJson.version, '-v, --version', 'output the current version');

// Command: init - Initialize FlowTrace in current project
program
  .command('init')
  .description('Initialize FlowTrace in current project (interactive TUI)')
  .option('--java', 'Force Java project type')
  .option('--node', 'Force Node.js project type')
  .option('-y, --yes', 'Accept all defaults without prompting')
  .option('--package-prefix <prefix>', 'Package prefix for filtering')
  .option('--shell <shell>', 'Shell preference (bash|zsh|powershell)')
  .action(async (options) => {
    try {
      const initCommand = require('../lib/commands/init');
      await initCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Command: install - Install FlowTrace agent
program
  .command('install <language>')
  .description('Install FlowTrace agent for specified language')
  .argument('<language>', 'Language to install (java|node)')
  .option('--global', 'Install globally (Java: ~/.m2, Node: npm -g)')
  .action(async (language, options) => {
    try {
      const installCommand = require('../lib/commands/install');
      await installCommand(language, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Command: run - Run application with FlowTrace
program
  .command('run [script]')
  .description('Run application with FlowTrace instrumentation')
  .option('-c, --config <path>', 'Path to FlowTrace config file')
  .option('--debug', 'Enable debug output (FLOWTRACE_STDOUT=true)')
  .action(async (script, options) => {
    try {
      const runCommand = require('../lib/commands/run');
      await runCommand(script, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Command: status - Show FlowTrace installation status
program
  .command('status')
  .description('Show FlowTrace installation and configuration status')
  .action(async () => {
    try {
      const statusCommand = require('../lib/commands/status');
      await statusCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Command: update - Update FlowTrace CLI and agents
program
  .command('update')
  .description('Update FlowTrace CLI and project agents')
  .option('--cli-only', 'Update only CLI, not project agents')
  .action(async (options) => {
    try {
      const updateCommand = require('../lib/commands/update');
      await updateCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
