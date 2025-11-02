import { fileExists } from '../utils/validation.js';

export type Language = 'node' | 'java' | 'python' | 'unknown';

export interface LanguageDetectionResult {
  language: Language;
  confidence: number;
  indicators: string[];
}

/**
 * Detect programming language from project structure
 */
export function detectLanguage(projectPath: string): LanguageDetectionResult {
  const indicators: string[] = [];
  let language: Language = 'unknown';
  let confidence = 0;

  // Node.js detection
  if (fileExists(projectPath, 'package.json')) {
    indicators.push('package.json');
    language = 'node';
    confidence += 50;
  }

  if (fileExists(projectPath, 'node_modules')) {
    indicators.push('node_modules/');
    confidence += 20;
  }

  if (
    fileExists(projectPath, 'yarn.lock') ||
    fileExists(projectPath, 'package-lock.json') ||
    fileExists(projectPath, 'pnpm-lock.yaml')
  ) {
    indicators.push('lock file');
    confidence += 15;
  }

  // Java detection
  if (fileExists(projectPath, 'pom.xml')) {
    indicators.push('pom.xml');
    if (language === 'unknown') language = 'java';
    confidence += 50;
  }

  if (fileExists(projectPath, 'build.gradle') || fileExists(projectPath, 'build.gradle.kts')) {
    indicators.push('build.gradle');
    if (language === 'unknown') language = 'java';
    confidence += 50;
  }

  if (fileExists(projectPath, 'src', 'main', 'java')) {
    indicators.push('src/main/java/');
    confidence += 25;
  }

  if (fileExists(projectPath, 'mvnw') || fileExists(projectPath, 'gradlew')) {
    indicators.push('wrapper script');
    confidence += 15;
  }

  // Python detection
  if (fileExists(projectPath, 'requirements.txt')) {
    indicators.push('requirements.txt');
    if (language === 'unknown') language = 'python';
    confidence += 50;
  }

  if (fileExists(projectPath, 'setup.py') || fileExists(projectPath, 'pyproject.toml')) {
    indicators.push('setup.py/pyproject.toml');
    if (language === 'unknown') language = 'python';
    confidence += 40;
  }

  if (fileExists(projectPath, 'Pipfile') || fileExists(projectPath, 'poetry.lock')) {
    indicators.push('Pipfile/poetry.lock');
    confidence += 20;
  }

  if (fileExists(projectPath, 'manage.py')) {
    indicators.push('manage.py');
    confidence += 30;
  }

  // Cap confidence at 100
  confidence = Math.min(confidence, 100);

  return {
    language,
    confidence,
    indicators,
  };
}

/**
 * Get language display name
 */
export function getLanguageName(language: Language): string {
  const names: Record<Language, string> = {
    node: 'Node.js/JavaScript/TypeScript',
    java: 'Java',
    python: 'Python',
    unknown: 'Unknown',
  };
  return names[language];
}
