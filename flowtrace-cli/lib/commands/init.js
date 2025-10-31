/**
 * Init Command - Initialize FlowTrace in project
 * Interactive TUI for project configuration
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs-extra');
const path = require('path');
const ProjectDetector = require('../detectors/project-detector');
const JavaInstaller = require('../installers/java-installer');
const NodeInstaller = require('../installers/node-installer');

async function initCommand(options) {
  console.log(chalk.bold.cyan('\n🚀 FlowTrace Project Initialization\n'));

  const projectPath = process.cwd();
  const detector = new ProjectDetector(projectPath);

  // Step 1: Detect project information
  const spinner = ora('Detecting project configuration...').start();
  const detected = await detector.detectAll();
  spinner.succeed('Project detected');

  // Display detected information
  console.log(chalk.gray('\nDetected Configuration:'));
  console.log(chalk.gray(`  Project Type: ${detected.projectType}`));
  console.log(chalk.gray(`  Framework: ${detected.framework}`));
  console.log(chalk.gray(`  Package Prefix: ${detected.packagePrefix || '(not detected)'}`));
  console.log(chalk.gray(`  Entry Point: ${detected.entryPoint || '(not detected)'}`));
  console.log(chalk.gray(`  Shell: ${detected.shell}`));

  // Step 2: Interactive prompts (unless --yes flag)
  let config;

  if (options.yes) {
    // Use detected values
    config = {
      language: detected.projectType.startsWith('java') ? 'java' : 'node',
      packagePrefix: detected.packagePrefix || '',
      framework: detected.framework,
      entryPoint: detected.entryPoint,
      createLauncher: true,
      shell: detected.shell,
      addGitIgnore: true
    };
  } else {
    // Interactive TUI
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'language',
        message: 'Select project language:',
        default: detected.projectType.startsWith('java') ? 'java' : 'node',
        choices: [
          { name: 'Java (Maven/Gradle)', value: 'java' },
          { name: 'Node.js / TypeScript', value: 'node' },
          { name: 'Other (manual setup)', value: 'other' }
        ],
        when: () => !options.java && !options.node
      },
      {
        type: 'input',
        name: 'packagePrefix',
        message: 'Package prefix for filtering (e.g., com.example.app):',
        default: detected.packagePrefix || '',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Package prefix is required for effective filtering';
          }
          return true;
        },
        when: (answers) => {
          const lang = answers.language || options.java ? 'java' : options.node ? 'node' : detected.projectType;
          return lang === 'java' || lang === 'node';
        }
      },
      {
        type: 'input',
        name: 'entryPoint',
        message: 'Application entry point:',
        default: detected.entryPoint || '',
        when: (answers) => {
          const lang = answers.language || 'java';
          return lang !== 'other';
        }
      },
      {
        type: 'confirm',
        name: 'createLauncher',
        message: 'Create launcher script (run-and-flowtrace)?',
        default: true
      },
      {
        type: 'list',
        name: 'shell',
        message: 'Select shell preference:',
        default: detected.shell,
        choices: [
          { name: 'Bash', value: 'bash' },
          { name: 'Zsh', value: 'zsh' },
          { name: 'PowerShell', value: 'powershell' }
        ],
        when: (answers) => answers.createLauncher
      },
      {
        type: 'confirm',
        name: 'addGitIgnore',
        message: 'Add flowtrace.jsonl to .gitignore?',
        default: true
      }
    ]);

    config = {
      ...answers,
      language: answers.language || (options.java ? 'java' : options.node ? 'node' : detected.projectType.startsWith('java') ? 'java' : 'node'),
      framework: detected.framework
    };
  }

  // Handle 'other' language selection
  if (config.language === 'other') {
    console.log(chalk.yellow('\n⚠️  Manual setup required. Please refer to documentation.'));
    return;
  }

  // Step 3: Install agent
  console.log(chalk.cyan('\n📦 Installing FlowTrace agent...\n'));

  try {
    if (config.language === 'java') {
      const javaInstaller = new JavaInstaller(projectPath);
      await javaInstaller.install(config);
    } else if (config.language === 'node') {
      const nodeInstaller = new NodeInstaller(projectPath);
      await nodeInstaller.install(config);
    }

    // Step 4: Create configuration file
    await createConfigFile(projectPath, config);

    // Step 5: Update .gitignore
    if (config.addGitIgnore) {
      await updateGitIgnore(projectPath);
    }

    // Step 6: Success message
    console.log(chalk.green.bold('\n✅ FlowTrace initialized successfully!\n'));
    console.log(chalk.gray('Created files:'));
    console.log(chalk.gray(`  - .flowtrace/config.json`));
    console.log(chalk.gray(`  - .flowtrace/flowtrace-agent${config.language === 'java' ? '.jar' : '-js/'}`));

    if (config.createLauncher) {
      const scriptExt = config.shell === 'powershell' ? 'ps1' : 'sh';
      console.log(chalk.gray(`  - run-and-flowtrace.${scriptExt}`));
    }

    console.log(chalk.gray(`  - flowtrace-jsonsl/ (truncated logs folder - auto-created on first run)`));

    console.log(chalk.cyan('\n📚 Next steps:'));

    if (config.language === 'java') {
      console.log(chalk.gray('  1. Build your project: mvn clean package'));
      if (config.createLauncher) {
        console.log(chalk.gray('  2. Run with FlowTrace: ./run-and-flowtrace.sh'));
      } else {
        console.log(chalk.gray('  2. Run with FlowTrace: java -javaagent:.flowtrace/flowtrace-agent.jar -jar target/your-app.jar'));
      }
    } else {
      if (config.createLauncher) {
        console.log(chalk.gray('  1. Run with FlowTrace: ./run-and-flowtrace.sh'));
      } else {
        console.log(chalk.gray('  1. Run with FlowTrace: npm run trace'));
      }
    }

    console.log(chalk.gray('  3. Check trace output: cat flowtrace.jsonl'));
    console.log(chalk.gray('  4. Check full truncated logs: ls flowtrace-jsonsl/'));
    console.log();

  } catch (error) {
    console.error(chalk.red('\n❌ Installation failed:'), error.message);
    throw error;
  }
}

/**
 * Create .flowtrace/config.json
 */
async function createConfigFile(projectPath, config) {
  const configDir = path.join(projectPath, '.flowtrace');
  await fs.ensureDir(configDir);

  const configFile = path.join(configDir, 'config.json');
  const configData = {
    version: '1.0.0',
    language: config.language,
    packagePrefix: config.packagePrefix,
    framework: config.framework,
    entryPoint: config.entryPoint,
    logFile: 'flowtrace.jsonl',
    stdout: false,
    exclude: [],
    launcher: {
      shell: config.shell,
      script: `run-and-flowtrace.${config.shell === 'powershell' ? 'ps1' : 'sh'}`
    }
  };

  await fs.writeJson(configFile, configData, { spaces: 2 });
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

module.exports = initCommand;
