'use strict';
/**
 * Traces must not be committable.
 *
 * A trace records ARGUMENT VALUES — for a real application that means request
 * bodies, tokens, email addresses. The CLI advertises auto-gitignoring, and both
 * `init` and `run` carried their own copy of the logic, both gated on
 * `fs.existsSync(path.join(cwd, '.git'))`.
 *
 * That check only holds when you run from the repository root. Run from a
 * subdirectory — the normal case in a monorepo or any packages/api-shaped layout
 * — and it failed silently: traces were written and left untracked but NOT
 * ignored, so `git add .` would commit them.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { ensureGitignore, findRepoRoot, alreadyIgnored } = require('../lib/gitignore');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    fail += 1;
  }
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gi-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** Ask git itself, rather than trusting our own file-content check. */
function gitIgnores(repo, relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

console.log('\ngitignore handling\n');

test('a subdirectory of a repository is covered', () => {
  // The regression: this is what silently did nothing before.
  const repo = tmpRepo();
  try {
    const sub = path.join(repo, 'packages', 'api');
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(path.join(sub, '.flowtrace'), { recursive: true });

    const result = ensureGitignore(sub);
    assert.strictEqual(result.changed, true, `expected a change, got ${result.reason}`);
    assert.ok(
      gitIgnores(repo, 'packages/api/.flowtrace/'),
      'git still does not ignore the trace directory'
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the repository root itself is covered', () => {
  const repo = tmpRepo();
  try {
    fs.mkdirSync(path.join(repo, '.flowtrace'), { recursive: true });
    assert.strictEqual(ensureGitignore(repo).changed, true);
    assert.ok(gitIgnores(repo, '.flowtrace/'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('it is idempotent — a second call adds nothing', () => {
  const repo = tmpRepo();
  try {
    ensureGitignore(repo);
    const first = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    const second = ensureGitignore(repo);
    assert.strictEqual(second.changed, false);
    assert.strictEqual(second.reason, 'already-ignored');
    assert.strictEqual(fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8'), first);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('an existing .gitignore is appended to, not overwritten', () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n');
    ensureGitignore(repo);
    const content = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8');
    assert.ok(content.includes('node_modules/'), 'existing entries were lost');
    assert.ok(content.includes('dist/'), 'existing entries were lost');
    assert.ok(content.includes('.flowtrace/'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a missing trailing newline does not join two entries', () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/'); // no newline
    ensureGitignore(repo);
    const lines = fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8').split('\n');
    assert.ok(lines.includes('dist/'), `entries were joined: ${JSON.stringify(lines)}`);
    assert.ok(lines.includes('.flowtrace/'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('an entry already present at the repo root is not duplicated in a subdirectory', () => {
  // Otherwise every service directory in a monorepo accumulates a one-line file.
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, '.gitignore'), '.flowtrace/\n');
    const sub = path.join(repo, 'services', 'worker');
    fs.mkdirSync(sub, { recursive: true });

    const result = ensureGitignore(sub);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.reason, 'already-ignored');
    assert.ok(!fs.existsSync(path.join(sub, '.gitignore')), 'created a redundant .gitignore');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('outside a git repository nothing is written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nogit-'));
  try {
    const result = ensureGitignore(dir);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.reason, 'not-a-git-repo');
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')), 'created a .gitignore outside a repo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('.git as a FILE is recognised, as in a worktree or submodule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-wt-'));
  try {
    // git worktrees and submodules write a .git FILE containing a gitdir pointer.
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
    assert.strictEqual(findRepoRoot(dir), path.resolve(dir));
    assert.strictEqual(ensureGitignore(dir).changed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('alreadyIgnored accepts the forms git accepts', () => {
  const repo = tmpRepo();
  try {
    for (const form of ['.flowtrace', '.flowtrace/', '/.flowtrace/']) {
      fs.writeFileSync(path.join(repo, '.gitignore'), `${form}\n`);
      assert.ok(alreadyIgnored(repo, repo), `form not recognised: ${form}`);
    }
    fs.writeFileSync(path.join(repo, '.gitignore'), 'flowtrace-notours/\n');
    assert.ok(!alreadyIgnored(repo, repo), 'matched an unrelated entry');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
