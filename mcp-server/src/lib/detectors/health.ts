import { Framework } from './framework.js';

export interface HealthCheckConfig {
  successPatterns: RegExp[];
  errorPatterns: RegExp[];
  timeoutMs: number;
}

/**
 * Get health check configuration for framework
 */
export function getHealthCheckConfig(framework: Framework): HealthCheckConfig {
  const configs: Record<Framework, Partial<HealthCheckConfig>> = {
    'react-cra': {
      successPatterns: [
        /Compiled successfully!/i,
        /webpack compiled/i,
        /Local:\s+http:\/\/localhost:\d+/,
      ],
      timeoutMs: 60000, // 60 seconds
    },
    'nextjs': {
      successPatterns: [
        /ready - started server on/i,
        /Local:\s+http:\/\/localhost:\d+/,
        /compiled successfully/i,
      ],
      timeoutMs: 60000,
    },
    'express': {
      successPatterns: [
        /listening on port/i,
        /server started/i,
        /Express server listening/i,
      ],
      timeoutMs: 30000,
    },
    'angular': {
      successPatterns: [
        /Compiled successfully/i,
        /Angular Live Development Server is listening/i,
      ],
      timeoutMs: 90000, // Angular can be slow
    },
    'vue': {
      successPatterns: [
        /App running at:/i,
        /Compiled successfully/i,
      ],
      timeoutMs: 60000,
    },
    'spring-boot': {
      successPatterns: [
        /Started .* in .* seconds/i,
        /Tomcat started on port/i,
        /Application startup complete/i,
      ],
      timeoutMs: 90000, // Spring Boot can be slow
    },
    'django': {
      successPatterns: [
        /Starting development server at/i,
        /Django version .*, using settings/i,
        /Quit the server with/i,
      ],
      timeoutMs: 30000,
    },
    'fastapi': {
      successPatterns: [
        /Uvicorn running on/i,
        /Application startup complete/i,
        /Started server process/i,
      ],
      timeoutMs: 30000,
    },
    'flask': {
      successPatterns: [
        /Running on http:\/\//i,
        /WARNING: This is a development server/i,
      ],
      timeoutMs: 20000,
    },
    'generic': {
      successPatterns: [
        /listening/i,
        /started/i,
        /running/i,
        /ready/i,
      ],
      timeoutMs: 60000,
    },
    'unknown': {
      successPatterns: [
        /listening/i,
        /started/i,
        /running/i,
        /ready/i,
      ],
      timeoutMs: 60000,
    },
  };

  // Common error patterns for all frameworks
  const commonErrorPatterns = [
    /Error:/i,
    /Exception in thread/i,
    /EADDRINUSE/i,
    /Cannot find module/i,
    /Failed to compile/i,
    /BUILD FAILURE/i,
    /SyntaxError/i,
    /TypeError/i,
    /ModuleNotFoundError/i,
    /ImportError/i,
    /java\.lang\..*Exception/i,
    /Caused by:/i,
  ];

  const frameworkConfig = configs[framework] || configs.generic;

  return {
    successPatterns: frameworkConfig.successPatterns || configs.generic.successPatterns!,
    errorPatterns: commonErrorPatterns,
    timeoutMs: frameworkConfig.timeoutMs || 60000,
  };
}

/**
 * Extract useful information from startup logs
 */
export interface StartupInfo {
  port?: number;
  url?: string;
  pid?: number;
  framework?: string;
}

export function extractStartupInfo(output: string): StartupInfo {
  const info: StartupInfo = {};

  // Extract port
  const portPatterns = [
    /port[:\s]+(\d+)/i,
    /http:\/\/[^:]+:(\d+)/,
    /localhost:(\d+)/,
    /0\.0\.0\.0:(\d+)/,
    /Tomcat started on port\(s\):\s*(\d+)/,
  ];

  for (const pattern of portPatterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      info.port = parseInt(match[1], 10);
      break;
    }
  }

  // Extract URL
  const urlPattern = /(https?:\/\/[^\s]+)/;
  const urlMatch = output.match(urlPattern);
  if (urlMatch) {
    info.url = urlMatch[1];
  }

  // Extract framework version info
  if (output.includes('Spring Boot')) {
    const versionMatch = output.match(/Spring Boot\s+([\d.]+)/);
    if (versionMatch) {
      info.framework = `Spring Boot ${versionMatch[1]}`;
    }
  } else if (output.includes('Django version')) {
    const versionMatch = output.match(/Django version ([\d.]+)/);
    if (versionMatch) {
      info.framework = `Django ${versionMatch[1]}`;
    }
  }

  return info;
}
