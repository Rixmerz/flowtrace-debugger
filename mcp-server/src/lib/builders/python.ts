import { executeCommand } from '../utils/shell.js';
import { fileExists } from '../utils/validation.js';

export interface BuildResult {
  success: boolean;
  buildCommand?: string;
  output: string;
  error?: string;
  requiresBuild: boolean;
}

/**
 * Build Python project (install dependencies)
 */
export async function buildPythonProject(projectPath: string): Promise<BuildResult> {
  const result: BuildResult = {
    success: false,
    output: '',
    requiresBuild: false,
  };

  // Check for requirements.txt
  if (fileExists(projectPath, 'requirements.txt')) {
    result.requiresBuild = true;
    result.buildCommand = 'pip install -r requirements.txt';

    const installResult = await executeCommand(
      'pip install -r requirements.txt',
      projectPath,
      300000 // 5 min timeout
    );

    result.output = installResult.stdout;
    result.error = installResult.stderr;
    result.success = installResult.success;

    if (!result.success) {
      return result;
    }
  }

  // Check for Pipfile (pipenv)
  if (fileExists(projectPath, 'Pipfile')) {
    result.requiresBuild = true;
    result.buildCommand = result.buildCommand ? 'pip install && pipenv install' : 'pipenv install';

    const installResult = await executeCommand('pipenv install', projectPath, 300000);
    result.output += '\n' + installResult.stdout;
    result.error = (result.error || '') + '\n' + installResult.stderr;
    result.success = installResult.success;

    if (!result.success) {
      return result;
    }
  }

  // Check for pyproject.toml (poetry)
  if (fileExists(projectPath, 'pyproject.toml')) {
    result.requiresBuild = true;
    result.buildCommand = result.buildCommand
      ? result.buildCommand + ' && poetry install'
      : 'poetry install';

    const installResult = await executeCommand('poetry install', projectPath, 300000);
    result.output += '\n' + installResult.stdout;
    result.error = (result.error || '') + '\n' + installResult.stderr;
    result.success = installResult.success;

    if (!result.success) {
      return result;
    }
  }

  // Run Django migrations if manage.py exists
  if (fileExists(projectPath, 'manage.py')) {
    const migrateResult = await executeCommand('python manage.py migrate', projectPath, 120000);
    result.output += '\n' + migrateResult.stdout;

    if (!migrateResult.success) {
      // Migrations are optional, don't fail if they don't work
      result.output += '\nNote: Migrations failed or not needed';
    }
  }

  // If no build was required
  if (!result.requiresBuild) {
    result.success = true;
    result.output = 'No dependencies to install';
  }

  return result;
}
