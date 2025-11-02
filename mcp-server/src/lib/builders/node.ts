import { executeCommand } from '../utils/shell.js';
import { fileExists } from '../utils/validation.js';

export interface BuildResult {
  success: boolean;
  buildCommand?: string;
  output: string;
  error?: string;
  requiresBuild: boolean;
  artifacts?: string[];
}

/**
 * Build Node.js project
 */
export async function buildNodeProject(projectPath: string): Promise<BuildResult> {
  const result: BuildResult = {
    success: false,
    output: '',
    requiresBuild: false,
  };

  // Check if node_modules exists
  const hasNodeModules = fileExists(projectPath, 'node_modules');

  if (!hasNodeModules) {
    result.requiresBuild = true;
    result.buildCommand = 'npm install';

    // Run npm install
    const installResult = await executeCommand('npm install', projectPath, 300000); // 5 min timeout
    result.output += installResult.stdout;
    result.error = installResult.stderr;
    result.success = installResult.success;

    if (!result.success) {
      return result;
    }
  }

  // Check if build script exists in package.json
  try {
    const packageJsonPath = `${projectPath}/package.json`;
    const { readFileSync } = await import('fs');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    if (packageJson.scripts && packageJson.scripts.build) {
      result.requiresBuild = true;
      result.buildCommand = result.buildCommand ? 'npm install && npm run build' : 'npm run build';

      // Run build
      const buildResult = await executeCommand('npm run build', projectPath, 600000); // 10 min timeout
      result.output += '\n' + buildResult.stdout;
      result.error = (result.error || '') + '\n' + buildResult.stderr;
      result.success = buildResult.success;

      if (buildResult.success) {
        // Check for common build artifact directories
        const artifactDirs = ['dist', 'build', '.next'];
        result.artifacts = artifactDirs.filter(dir => fileExists(projectPath, dir));
      }

      return result;
    }
  } catch (error: any) {
    result.error = (result.error || '') + `\nFailed to read package.json: ${error.message}`;
  }

  // No build required or build already complete
  result.success = true;
  result.output = result.output || 'Dependencies are up to date';

  return result;
}
