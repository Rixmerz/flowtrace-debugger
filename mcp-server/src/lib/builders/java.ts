import { executeCommand } from '../utils/shell.js';
import { fileExists, findFiles } from '../utils/validation.js';
import { join } from 'path';

export interface BuildResult {
  success: boolean;
  buildCommand?: string;
  output: string;
  error?: string;
  requiresBuild: boolean;
  artifacts?: string[];
  jarPath?: string;
}

/**
 * Build Java project (Maven or Gradle)
 */
export async function buildJavaProject(
  projectPath: string,
  clean: boolean = true
): Promise<BuildResult> {
  const result: BuildResult = {
    success: false,
    output: '',
    requiresBuild: true,
  };

  // Detect build tool
  const isMaven = fileExists(projectPath, 'pom.xml');
  const isGradle = fileExists(projectPath, 'build.gradle') || fileExists(projectPath, 'build.gradle.kts');

  if (!isMaven && !isGradle) {
    result.error = 'No Maven (pom.xml) or Gradle (build.gradle) configuration found';
    return result;
  }

  // Build with Maven
  if (isMaven) {
    const command = clean ? 'mvn clean package' : 'mvn package';
    result.buildCommand = command;

    const buildResult = await executeCommand(command, projectPath, 600000); // 10 min timeout
    result.output = buildResult.stdout;
    result.error = buildResult.stderr;
    result.success = buildResult.success;

    if (result.success) {
      // Find JAR files in target directory
      const targetDir = join(projectPath, 'target');
      const jarFiles = findFiles(targetDir, /\.jar$/, [/-sources\.jar$/, /-javadoc\.jar$/]);

      if (jarFiles.length > 0) {
        result.artifacts = jarFiles;
        result.jarPath = jarFiles[0]; // Use first JAR found
      } else {
        result.error = 'Build succeeded but no JAR file found in target/';
        result.success = false;
      }
    }

    return result;
  }

  // Build with Gradle
  if (isGradle) {
    const command = clean ? './gradlew clean build' : './gradlew build';
    result.buildCommand = command;

    // Check if gradlew exists, otherwise use gradle
    const useWrapper = fileExists(projectPath, 'gradlew');
    const actualCommand = useWrapper ? command : command.replace('./gradlew', 'gradle');

    const buildResult = await executeCommand(actualCommand, projectPath, 600000);
    result.output = buildResult.stdout;
    result.error = buildResult.stderr;
    result.success = buildResult.success;

    if (result.success) {
      // Find JAR files in build/libs directory
      const buildLibsDir = join(projectPath, 'build', 'libs');
      const jarFiles = findFiles(buildLibsDir, /\.jar$/, [/-sources\.jar$/, /-javadoc\.jar$/]);

      if (jarFiles.length > 0) {
        result.artifacts = jarFiles;
        result.jarPath = jarFiles[0];
      } else {
        result.error = 'Build succeeded but no JAR file found in build/libs/';
        result.success = false;
      }
    }

    return result;
  }

  return result;
}
