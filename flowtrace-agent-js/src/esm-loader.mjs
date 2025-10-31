/**
 * FlowTrace ESM Loader
 * Used with --loader flag for ES Modules: node --loader flowtrace-agent-js/src/esm-loader.mjs app.mjs
 *
 * Note: This is experimental and requires Node.js 16+
 */

import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import path from 'path';

// Load config (using dynamic import for CommonJS modules)
let config, exclusions;

async function loadDependencies() {
  const configModule = await import('./config.js');
  const exclusionsModule = await import('./exclusions.js');
  config = configModule.default;
  exclusions = exclusionsModule.default;
}

// Initialize
await loadDependencies();

/**
 * Resolve hook - determines how module URLs are resolved
 */
export async function resolve(specifier, context, defaultResolve) {
  return defaultResolve(specifier, context);
}

/**
 * Load hook - loads and potentially transforms module source
 */
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);

  // Only transform JavaScript/TypeScript files
  if (!url.endsWith('.js') && !url.endsWith('.mjs') && !url.endsWith('.ts')) {
    return result;
  }

  // Check if should instrument
  const filePath = url.startsWith('file://') ? url.slice(7) : url;

  if (exclusions.shouldExclude(filePath)) {
    return result;
  }

  if (config.packagePrefix && !config.shouldInstrument(filePath)) {
    return result;
  }

  // Transform the source code
  try {
    let source = result.source;

    // Convert Buffer to string if needed
    if (Buffer.isBuffer(source)) {
      source = source.toString('utf-8');
    }

    // Simple instrumentation: inject import and wrap exports
    // This is a basic implementation - for production, use a proper AST transformer
    const instrumented = instrumentSource(source, filePath);

    return {
      ...result,
      source: instrumented
    };
  } catch (error) {
    console.error(`FlowTrace: Error instrumenting ${filePath}:`, error.message);
    return result;
  }
}

/**
 * Basic source code instrumentation
 * Note: This is a simplified version. For production, use Babel or similar AST transformer
 */
function instrumentSource(source, filePath) {
  // Extract module name for logging
  const moduleName = path.basename(filePath, path.extname(filePath));

  // Inject FlowTrace import at the top
  const injectedImport = `
// FlowTrace instrumentation
import { createRequire } from 'module';
const __flowtrace_require = createRequire(import.meta.url);
const __flowtrace_logger = __flowtrace_require('${path.resolve(__dirname, './logger.js')}');
const __flowtrace_inst = __flowtrace_require('${path.resolve(__dirname, './instrumentation.js')}');
`;

  // Wrap function declarations (simple regex-based approach)
  // For production, use proper AST transformation
  let instrumented = source;

  // This is a placeholder - in production, you would:
  // 1. Parse source to AST (using @babel/parser or similar)
  // 2. Transform AST to wrap functions
  // 3. Generate code back from AST

  return injectedImport + '\n' + instrumented;
}

console.error('FlowTrace: ESM Loader initialized');
