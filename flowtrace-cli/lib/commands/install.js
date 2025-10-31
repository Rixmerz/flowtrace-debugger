/**
 * Install Command - Install FlowTrace agent
 */

const chalk = require('chalk');
const JavaInstaller = require('../installers/java-installer');
const NodeInstaller = require('../installers/node-installer');

async function installCommand(language, options) {
  console.log(chalk.bold.cyan(`\n📦 Installing FlowTrace ${language.toUpperCase()} Agent\n`));

  const projectPath = process.cwd();

  try {
    if (language === 'java') {
      const installer = new JavaInstaller(projectPath);
      await installer.copyAgent();
      console.log(chalk.green('\n✓ Java agent installed successfully\n'));
    } else if (language === 'node' || language === 'nodejs') {
      const installer = new NodeInstaller(projectPath);
      await installer.copyAgent();
      console.log(chalk.green('\n✓ Node.js agent installed successfully\n'));
    } else {
      console.error(chalk.red(`Error: Unknown language: ${language}`));
      console.log(chalk.gray('Supported: java, node'));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\n✗ Installation failed:'), error.message);
    process.exit(1);
  }
}

module.exports = installCommand;
