/**
 * Python Installer - Install FlowtTrace Python agent
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class PythonInstaller {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  async install(config) {
    console.log('Installing FlowtTrace Python agent...');

    // Create .flowtrace directory
    const flowtraceDirPath = path.join(this.projectPath, '.flowtrace');
    await fs.ensureDir(flowtraceDirPath);

    // Install Python package
    await this.installPythonPackage();

    // Create configuration
    await this.createConfig(config);

    // Create run script
    if (config.createLauncher) {
      await this.createLauncherScript(config);
    }

    console.log('✓ Python agent installed successfully');
  }

  async installPythonPackage() {
    // Get path to Python agent
    const agentPath = path.join(__dirname, '../../../agents/python');

    // Install in development mode
    return new Promise((resolve, reject) => {
      const pip = spawn('pip', ['install', '-e', agentPath], {
        cwd: this.projectPath,
        stdio: 'inherit'
      });

      pip.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pip install failed with code ${code}`));
        }
      });
    });
  }

  async createConfig(config) {
    const configPath = path.join(this.projectPath, '.flowtrace', 'config.json');
    const configData = {
      version: '1.0.0',
      language: 'python',
      packagePrefix: config.packagePrefix || '',
      framework: config.framework || 'python-plain',
      logFile: 'flowtrace.jsonl',
      stdout: false,
      maxArgLength: 1000,
      exclude: []
    };

    await fs.writeJson(configPath, configData, { spaces: 2 });
  }

  async createLauncherScript(config) {
    const scriptPath = path.join(this.projectPath, 'run-and-flowtrace.sh');
    const scriptContent = `#!/bin/bash
# FlowTrace Python launcher script

# Set environment variables
export FLOWTRACE_PACKAGE_PREFIX="${config.packagePrefix || ''}"
export FLOWTRACE_LOGFILE="flowtrace.jsonl"
export FLOWTRACE_STDOUT=false

# Run with Flowtrace
python -c "
import flowtrace_agent
flowtrace_agent.start_tracing()

# Import and run your application
import sys
sys.path.insert(0, '${this.projectPath}')

# Run main application
exec(open('${config.entryPoint || 'main.py'}').read())
"
`;

    await fs.writeFile(scriptPath, scriptContent);
    await fs.chmod(scriptPath, '755');
  }
}

module.exports = PythonInstaller;
