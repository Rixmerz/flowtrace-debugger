import { existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Validate project path exists and is a directory
 */
export function validateProjectPath(projectPath: string): {
  valid: boolean;
  error?: string;
} {
  if (!projectPath) {
    return { valid: false, error: 'Project path is required' };
  }

  if (!existsSync(projectPath)) {
    return { valid: false, error: `Project path does not exist: ${projectPath}` };
  }

  const stats = statSync(projectPath);
  if (!stats.isDirectory()) {
    return { valid: false, error: `Project path is not a directory: ${projectPath}` };
  }

  return { valid: true };
}

/**
 * Check if FlowTrace is initialized in project
 */
export function isFlowTraceInitialized(projectPath: string): boolean {
  const configPath = join(projectPath, '.flowtrace', 'config.json');
  return existsSync(configPath);
}

/**
 * Check if file exists in project
 */
export function fileExists(projectPath: string, ...pathSegments: string[]): boolean {
  const fullPath = join(projectPath, ...pathSegments);
  return existsSync(fullPath);
}

/**
 * Find files matching pattern in directory
 */
export function findFiles(
  directory: string,
  pattern: RegExp,
  excludePatterns: RegExp[] = []
): string[] {
  const fs = require('fs');
  const path = require('path');
  const results: string[] = [];

  function search(dir: string) {
    try {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        // Skip excluded patterns
        if (excludePatterns.some(p => p.test(fullPath))) {
          continue;
        }

        if (stat.isDirectory()) {
          // Skip node_modules, .git, etc.
          if (!['node_modules', '.git', 'dist', 'build', 'target'].includes(file)) {
            search(fullPath);
          }
        } else if (pattern.test(file)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  search(directory);
  return results;
}

/**
 * Extract port number from text
 */
export function extractPort(text: string): number | null {
  const patterns = [
    /port[:\s]+(\d+)/i,
    /http:\/\/[^:]+:(\d+)/,
    /localhost:(\d+)/,
    /0\.0\.0\.0:(\d+)/,
    /Tomcat started on port\(s\):\s*(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Validate health check patterns
 */
export function matchesHealthPattern(
  output: string,
  patterns: RegExp[]
): { matched: boolean; pattern?: string } {
  for (const pattern of patterns) {
    if (pattern.test(output)) {
      return { matched: true, pattern: pattern.toString() };
    }
  }
  return { matched: false };
}
