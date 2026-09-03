/**
 * Deliberately small. There was no linter at all, and the point of adding one
 * is to catch the class of defect that actually shipped here — an import that
 * was added and never used (`pathToFileURL` in bootstrap.mjs, sitting unused
 * while the code next to it concatenated a `file://` string by hand), a
 * variable left behind by a refactor, a `catch` that swallows without binding.
 *
 * It is NOT a style guide. This codebase's convention is "match the file you
 * are in", and a formatter fight across five languages' worth of contributors
 * would cost more than it returns. No stylistic rules are enabled on purpose.
 */
import js from '@eslint/js';
import globals from 'globals';

const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/target/**',
  'plugin/mcp/server.bundle.js',
  'flowtrace-cli/vendor/**',
  'flowtrace-dashboard/public/js/vendor/**',
  'examples/**',
  'capture/go/**',
  'capture/python/**',
];

export default [
  { ignores: IGNORED },
  js.configs.recommended,
  {
    // The workspace is ESM by default; CommonJS files are listed below.
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A promise nobody awaits or catches is how the async emitter lost the
      // tail of every trace; see capture/node/src/runtime/emitter.js.
      'require-atomic-updates': 'off',
    },
  },
  {
    // capture/node/src/cjs/ is deliberately NOT here: those files install the
    // hook FOR CommonJS and are themselves ESM.
    files: ['flowtrace-cli/**/*.js', 'flowtrace-dashboard/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['flowtrace-dashboard/public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      // The dashboard UI predates modules: each file declares a class at file
      // scope and hangs it on `window`, and the others use it. So each name is
      // both a definition here and a global there.
      globals: {
        ...globals.browser,
        Chart: 'readonly',
        APIClient: 'writable',
        FileUploader: 'writable',
        MetricsPanel: 'writable',
        ChartRenderer: 'writable',
        TableRenderer: 'writable',
        dashboard: 'writable',
      },
    },
    // ...which is exactly what no-redeclare objects to. The rule cannot tell a
    // script-scope class from a shadowed built-in, and rewriting this UI into
    // modules is not what adding a linter is for.
    rules: { 'no-redeclare': 'off' },
  },
  {
    files: ['capture/browser/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/test/**/*.{js,mjs}', '**/tests/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    // Warnings, not errors, in tests. An unused binding in a test is usually
    // documentation — a stub written to the full signature it stands in for,
    // or a destructured result that names what the call returns. Failing CI on
    // those would trade a real signal for a chore, and this linter was added
    // to catch the dead import in shipping code, not to tidy fixtures.
    rules: {
      'no-unused-vars': 'warn',
      'no-useless-assignment': 'warn',
      'no-async-promise-executor': 'warn',
    },
  },
];
