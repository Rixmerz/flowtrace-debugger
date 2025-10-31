/**
 * Script Generator
 * Generates launcher scripts from templates
 */

const fs = require('fs-extra');
const path = require('path');

class ScriptGenerator {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  /**
   * Generate Java launcher script
   */
  async generateJavaScript(config) {
    const templateName = config.shell === 'powershell' ? 'run-java-template.ps1' : 'run-java-template.sh';
    const templatePath = path.join(__dirname, '../../templates', templateName);
    const outputName = config.shell === 'powershell' ? 'run-and-flowtrace.ps1' : 'run-and-flowtrace.sh';
    const outputPath = path.join(this.projectPath, outputName);

    // Read template
    let template = await fs.readFile(templatePath, 'utf8');

    // Replace placeholders
    template = template.replace(/\{\{PACKAGE_PREFIX\}\}/g, config.packagePrefix || '');
    template = template.replace(/\{\{APP_JAR\}\}/g, config.entryPoint || '');

    // Write output
    await fs.writeFile(outputPath, template);

    // Make executable (Unix only)
    if (config.shell !== 'powershell') {
      await fs.chmod(outputPath, 0o755);
    }
  }

  /**
   * Generate Node.js launcher script
   */
  async generateNodeScript(config) {
    const templateName = config.shell === 'powershell' ? 'run-node-template.ps1' : 'run-node-template.sh';
    const templatePath = path.join(__dirname, '../../templates', templateName);
    const outputName = config.shell === 'powershell' ? 'run-and-flowtrace.ps1' : 'run-and-flowtrace.sh';
    const outputPath = path.join(this.projectPath, outputName);

    // Read template
    let template = await fs.readFile(templatePath, 'utf8');

    // Replace placeholders
    template = template.replace(/\{\{PACKAGE_PREFIX\}\}/g, config.packagePrefix || '');
    template = template.replace(/\{\{APP_SCRIPT\}\}/g, config.entryPoint || 'index.js');

    // Write output
    await fs.writeFile(outputPath, template);

    // Make executable (Unix only)
    if (config.shell !== 'powershell') {
      await fs.chmod(outputPath, 0o755);
    }
  }
}

module.exports = ScriptGenerator;
