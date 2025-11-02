import { readFileSync } from 'fs';
import { join } from 'path';
import { fileExists } from '../utils/validation.js';
import { Language } from './language.js';

export type Framework =
  | 'react-cra'
  | 'nextjs'
  | 'express'
  | 'angular'
  | 'vue'
  | 'spring-boot'
  | 'django'
  | 'fastapi'
  | 'flask'
  | 'generic'
  | 'unknown';

export interface FrameworkDetectionResult {
  framework: Framework;
  confidence: number;
  indicators: string[];
  entryPoint?: string;
  defaultPort?: number;
}

/**
 * Detect framework from project structure and dependencies
 */
export function detectFramework(projectPath: string, language: Language): FrameworkDetectionResult {
  if (language === 'node') {
    return detectNodeFramework(projectPath);
  } else if (language === 'java') {
    return detectJavaFramework(projectPath);
  } else if (language === 'python') {
    return detectPythonFramework(projectPath);
  }

  return {
    framework: 'unknown',
    confidence: 0,
    indicators: [],
  };
}

/**
 * Detect Node.js framework
 */
function detectNodeFramework(projectPath: string): FrameworkDetectionResult {
  const packageJsonPath = join(projectPath, 'package.json');

  if (!fileExists(projectPath, 'package.json')) {
    return {
      framework: 'generic',
      confidence: 50,
      indicators: ['No package.json, assuming generic Node.js'],
    };
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const indicators: string[] = [];
    let framework: Framework = 'generic';
    let confidence = 0;
    let entryPoint: string | undefined;
    let defaultPort: number | undefined;

    // React (Create React App)
    if (dependencies['react-scripts']) {
      indicators.push('react-scripts dependency');
      framework = 'react-cra';
      confidence = 95;
      defaultPort = 3000;
    } else if (dependencies['react'] && !dependencies['next']) {
      indicators.push('react dependency (not CRA)');
      framework = 'react-cra';
      confidence = 60;
      defaultPort = 3000;
    }

    // Next.js
    if (dependencies['next']) {
      indicators.push('next dependency');
      framework = 'nextjs';
      confidence = 95;
      defaultPort = 3000;
    }

    // Express
    if (dependencies['express']) {
      indicators.push('express dependency');
      framework = 'express';
      confidence = 90;
      defaultPort = 3000;

      // Look for common entry points
      if (fileExists(projectPath, 'app.js')) {
        entryPoint = 'app.js';
        indicators.push('app.js entry point');
      } else if (fileExists(projectPath, 'server.js')) {
        entryPoint = 'server.js';
        indicators.push('server.js entry point');
      } else if (fileExists(projectPath, 'index.js')) {
        entryPoint = 'index.js';
        indicators.push('index.js entry point');
      }
    }

    // Angular
    if (dependencies['@angular/core']) {
      indicators.push('@angular/core dependency');
      framework = 'angular';
      confidence = 95;
      defaultPort = 4200;
    }

    // Vue
    if (dependencies['vue']) {
      indicators.push('vue dependency');
      framework = 'vue';
      confidence = 85;
      defaultPort = 8080;
    }

    return {
      framework,
      confidence,
      indicators,
      entryPoint,
      defaultPort,
    };
  } catch (error) {
    return {
      framework: 'generic',
      confidence: 50,
      indicators: ['Failed to parse package.json'],
    };
  }
}

/**
 * Detect Java framework
 */
function detectJavaFramework(projectPath: string): FrameworkDetectionResult {
  const indicators: string[] = [];
  let framework: Framework = 'generic';
  let confidence = 0;
  let defaultPort: number | undefined;

  // Spring Boot detection from pom.xml
  if (fileExists(projectPath, 'pom.xml')) {
    try {
      const pomContent = readFileSync(join(projectPath, 'pom.xml'), 'utf-8');

      if (pomContent.includes('spring-boot-starter')) {
        indicators.push('spring-boot-starter in pom.xml');
        framework = 'spring-boot';
        confidence = 95;
        defaultPort = 8080;
      }

      if (pomContent.includes('spring-boot-starter-web')) {
        indicators.push('spring-boot-starter-web');
        confidence = 100;
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  // Spring Boot detection from build.gradle
  if (fileExists(projectPath, 'build.gradle') || fileExists(projectPath, 'build.gradle.kts')) {
    try {
      const gradleFile = fileExists(projectPath, 'build.gradle') ? 'build.gradle' : 'build.gradle.kts';
      const gradleContent = readFileSync(join(projectPath, gradleFile), 'utf-8');

      if (gradleContent.includes('spring-boot')) {
        indicators.push('spring-boot in build.gradle');
        framework = 'spring-boot';
        confidence = 95;
        defaultPort = 8080;
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  return {
    framework,
    confidence,
    indicators,
    defaultPort,
  };
}

/**
 * Detect Python framework
 */
function detectPythonFramework(projectPath: string): FrameworkDetectionResult {
  const indicators: string[] = [];
  let framework: Framework = 'generic';
  let confidence = 0;
  let defaultPort: number | undefined;

  // Django detection
  if (fileExists(projectPath, 'manage.py')) {
    indicators.push('manage.py file');
    framework = 'django';
    confidence = 95;
    defaultPort = 8000;
  }

  // Check requirements.txt
  if (fileExists(projectPath, 'requirements.txt')) {
    try {
      const requirements = readFileSync(join(projectPath, 'requirements.txt'), 'utf-8');

      if (requirements.includes('Django')) {
        indicators.push('Django in requirements.txt');
        framework = 'django';
        confidence = Math.max(confidence, 90);
        defaultPort = 8000;
      }

      if (requirements.includes('fastapi')) {
        indicators.push('fastapi in requirements.txt');
        framework = 'fastapi';
        confidence = 90;
        defaultPort = 8000;
      }

      if (requirements.includes('Flask')) {
        indicators.push('Flask in requirements.txt');
        framework = 'flask';
        confidence = 85;
        defaultPort = 5000;
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  return {
    framework,
    confidence,
    indicators,
    defaultPort,
  };
}

/**
 * Get framework display name
 */
export function getFrameworkName(framework: Framework): string {
  const names: Record<Framework, string> = {
    'react-cra': 'React (Create React App)',
    'nextjs': 'Next.js',
    'express': 'Express.js',
    'angular': 'Angular',
    'vue': 'Vue.js',
    'spring-boot': 'Spring Boot',
    'django': 'Django',
    'fastapi': 'FastAPI',
    'flask': 'Flask',
    'generic': 'Generic',
    'unknown': 'Unknown',
  };
  return names[framework];
}
