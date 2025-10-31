/**
 * Update Command - Update FlowTrace agents in current project
 */

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');

async function updateCommand(options) {
  const projectPath = process.cwd();
  const configPath = path.join(projectPath, '.flowtrace', 'config.json');

  console.log(chalk.bold.cyan('\n🔄 Updating FlowTrace Agent\n'));

  // Check if project is initialized
  if (!(await fs.pathExists(configPath))) {
    console.error(chalk.red('✗ No FlowTrace configuration found in current directory'));
    console.log(chalk.gray('  Run "flowtrace init" to initialize FlowTrace first\n'));
    process.exit(1);
  }

  // Read config to determine project type
  const config = await fs.readJson(configPath);
  const spinner = ora('Updating FlowTrace agent...').start();

  try {
    if (config.language === 'java') {
      // Update Java agent
      await updateJavaAgent(projectPath);
      spinner.succeed('Java agent updated');
    } else if (config.language === 'node') {
      // Update Node.js agent
      await updateNodeAgent(projectPath);
      spinner.succeed('Node.js agent updated');
    } else {
      spinner.warn('Unknown project type, skipping agent update');
    }

    // Update .gitignore to include flowtrace-jsonsl/ if not already present
    await updateGitIgnore(projectPath);

    console.log(chalk.green('\n✓ Update complete\n'));
  } catch (error) {
    spinner.fail('Failed to update agent');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Update Java agent
 */
async function updateJavaAgent(projectPath) {
  const sourceAgent = path.join(__dirname, '../../agents/java/flowtrace-agent.jar');
  const destAgent = path.join(projectPath, '.flowtrace/flowtrace-agent.jar');

  // Try bundled agent first
  let agentSource = sourceAgent;
  if (!(await fs.pathExists(sourceAgent))) {
    // Try parent flowtrace project
    const parentAgent = path.join(__dirname, '../../../flowtrace-agent/target/flowtrace-agent-1.0.0.jar');
    if (await fs.pathExists(parentAgent)) {
      agentSource = parentAgent;
    } else {
      throw new Error('Java agent not found. Please run install-all.sh in FlowTrace repository');
    }
  }

  await fs.copy(agentSource, destAgent);
}

/**
 * Update Node.js agent
 */
async function updateNodeAgent(projectPath) {
  const sourceAgent = path.join(__dirname, '../../agents/node/flowtrace-agent-js');
  const destAgent = path.join(projectPath, '.flowtrace/flowtrace-agent-js');

  // Try bundled agent first
  let agentSource = sourceAgent;
  if (!(await fs.pathExists(sourceAgent))) {
    // Try parent flowtrace project
    const parentAgent = path.join(__dirname, '../../../flowtrace-agent-js');
    if (await fs.pathExists(parentAgent)) {
      agentSource = parentAgent;
    } else {
      throw new Error('Node.js agent not found. Please run install-all.sh in FlowTrace repository');
    }
  }

  // Backup existing config if user made customizations
  const configBackup = path.join(projectPath, '.flowtrace/config.json');
  const hasConfig = await fs.pathExists(configBackup);
  let originalConfig;

  if (hasConfig) {
    originalConfig = await fs.readJson(configBackup);
  }

  // Copy updated agent
  await fs.remove(destAgent);
  await fs.copy(agentSource, destAgent);

  // Restore config
  if (hasConfig && originalConfig) {
    await fs.writeJson(configBackup, originalConfig, { spaces: 2 });
  }
}

/**
 * Update .gitignore to exclude flowtrace.jsonl, flowtrace-jsonsl/, and .env
 */
async function updateGitIgnore(projectPath) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const entries = ['flowtrace.jsonl', 'flowtrace-jsonsl/', '.env'];

  try {
    let gitignoreContent = '';

    if (await fs.pathExists(gitignorePath)) {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
    }

    // Add missing entries
    const entriesToAdd = entries.filter(entry => !gitignoreContent.includes(entry));

    if (entriesToAdd.length > 0) {
      gitignoreContent += `\n# FlowTrace log files\nflowtrace.jsonl\nflowtrace-jsonsl/\n\n# Environment variables\n.env\n`;
      await fs.writeFile(gitignorePath, gitignoreContent);
    }

  } catch (error) {
    console.warn(chalk.yellow('⚠️  Could not update .gitignore:', error.message));
  }
}

module.exports = updateCommand;
