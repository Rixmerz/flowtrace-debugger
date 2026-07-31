'use strict';
/**
 * Keep captured traces out of version control.
 *
 * This matters more than a convenience: a trace records ARGUMENT VALUES. For a
 * real application that means request bodies, tokens, email addresses — whatever
 * the traced functions were called with. Committing `.flowtrace/` by accident
 * publishes it.
 *
 * Both `init` and `run` used to carry their own copy of this logic, and both
 * gated on `fs.existsSync(path.join(cwd, '.git'))` — .git as a direct child of
 * the working directory. That holds only when you run from the repository root.
 * Run from a subdirectory, which is the normal case in a monorepo or any
 * `packages/api`-shaped layout, and the check failed silently: the traces were
 * written and left untracked-but-not-ignored, so `git add .` would commit them.
 * Verified against a fresh repo with the app in packages/api — `git check-ignore`
 * reported the directory as not ignored.
 *
 * The repository root is now located by walking up, and the ignore entry is
 * written next to the traces rather than into a shared root .gitignore, which
 * keeps the change local to where the artifacts actually are.
 */

const fs = require('fs');
const path = require('path');

const ENTRY = '.flowtrace/';

/**
 * Find the git repository containing `dir`, by walking up.
 *
 * `.git` is a directory in a normal clone but a FILE in a worktree or submodule,
 * so existence is checked rather than type.
 *
 * @param {string} dir
 * @returns {string|null} the repository root, or null if not inside one
 */
function findRepoRoot(dir) {
  let current = path.resolve(dir);
  // Stop at the filesystem root: path.dirname('/') === '/'.
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * True if `.flowtrace/` is already ignored for `dir`, by any .gitignore between
 * `dir` and the repository root.
 *
 * Checked across the whole chain so a project that already ignores the entry at
 * its root does not get a redundant file created in every subdirectory.
 *
 * @param {string} dir
 * @param {string} repoRoot
 */
function alreadyIgnored(dir, repoRoot) {
  let current = path.resolve(dir);
  const stop = path.resolve(repoRoot);
  for (;;) {
    const gi = path.join(current, '.gitignore');
    if (fs.existsSync(gi)) {
      try {
        // Match `.flowtrace`, `.flowtrace/`, and a leading-slash form.
        if (/^\/?\.flowtrace\/?\s*$/m.test(fs.readFileSync(gi, 'utf-8'))) return true;
      } catch {
        /* unreadable: treat as not ignored */
      }
    }
    if (current === stop) return false;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Ensure `.flowtrace/` is gitignored for traces written under `cwd`.
 *
 * No-op outside a git repository, and idempotent.
 *
 * @param {string} cwd
 * @returns {{ changed: boolean, reason: string, file?: string }}
 */
function ensureGitignore(cwd) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) return { changed: false, reason: 'not-a-git-repo' };
  if (alreadyIgnored(cwd, repoRoot)) return { changed: false, reason: 'already-ignored' };

  const target = path.join(cwd, '.gitignore');
  try {
    if (fs.existsSync(target)) {
      const content = fs.readFileSync(target, 'utf-8');
      fs.appendFileSync(target, (content.endsWith('\n') || content === '' ? '' : '\n') + ENTRY + '\n');
    } else {
      fs.writeFileSync(target, ENTRY + '\n');
    }
    return { changed: true, reason: 'added', file: target };
  } catch (err) {
    // Never fail a trace run over this, but do not pretend it worked either.
    return { changed: false, reason: `error: ${err.message}` };
  }
}

module.exports = { ensureGitignore, findRepoRoot, alreadyIgnored, ENTRY };
