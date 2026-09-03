'use strict';

const fs = require('fs');
const path = require('path');

/** The line `flowtrace run` and `flowtrace init` both want present. */
const ENTRY = '.flowtrace/';

/**
 * Whether a .gitignore already ignores the FlowTrace output directory.
 *
 * `.flowtrace` and `.flowtrace/` mean the same thing to git, and the two call
 * sites used to disagree about that: `init` matched either form, `run`
 * required the trailing slash. A project ignoring `.flowtrace` therefore got a
 * duplicate line appended by `run` that `init` would have left alone.
 */
function ignoresFlowtrace(content) {
  return content
    .split('\n')
    .some((line) => {
      const t = line.trim();
      return t === '.flowtrace' || t === '.flowtrace/' || t === '/.flowtrace' || t === '/.flowtrace/';
    });
}

/**
 * Adds `.flowtrace/` to the project's .gitignore when it is a git repository
 * and the entry is not already there. Idempotent; a no-op outside a repo.
 * @param {string} cwd project root
 * @returns {boolean} whether the file was modified
 */
function ensureGitignore(cwd) {
  if (!fs.existsSync(path.join(cwd, '.git'))) return false;
  const giPath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(giPath)) {
    fs.writeFileSync(giPath, `${ENTRY}\n`);
    return true;
  }
  const content = fs.readFileSync(giPath, 'utf-8');
  if (ignoresFlowtrace(content)) return false;
  fs.appendFileSync(giPath, (content.endsWith('\n') ? '' : '\n') + `${ENTRY}\n`);
  return true;
}

module.exports = { ensureGitignore, ignoresFlowtrace, ENTRY };
