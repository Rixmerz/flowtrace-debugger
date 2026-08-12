/**
 * Validates that the Claude Code plugin in plugin/ is actually installable.
 *
 * This exists because the plugin was registered in the marketplace and looked
 * correct in every way a human reads a repo, while being broken for anyone who
 * installed it: .mcp.json pointed at mcp-server/dist/server.js, which was
 * gitignored (so absent from a clone), lived outside CLAUDE_PLUGIN_ROOT (so
 * absent from an install), and needed node_modules beside it (so unrunnable
 * even if present). Three independent faults, none visible from the repo,
 * every one of them fatal at install time.
 *
 * The checks below are the mechanical version of "did we ship something that
 * runs on a machine that is not this one".
 *
 * Usage: node scripts/check-plugin.mjs
 */
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugin');

const failures = [];
function fail(msg) { failures.push(msg); }
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${relative(ROOT, path)}: unreadable or invalid JSON — ${err.message}`);
    return null;
  }
}

/** True when git tracks `path`. An untracked file does not survive a clone. */
function isTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relative(ROOT, path)], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

// -- 1. Manifests parse and agree -----------------------------------------

const manifest = readJson(join(PLUGIN, '.claude-plugin', 'plugin.json'));
if (manifest) {
  for (const field of ['name', 'description', 'version']) {
    if (!manifest[field]) fail(`plugin.json: missing required field "${field}"`);
  }
}

const marketplace = readJson(join(ROOT, '.claude-plugin', 'marketplace.json'));
if (marketplace && manifest) {
  const entry = (marketplace.plugins ?? []).find((p) => p.name === manifest.name);
  if (!entry) {
    fail(`marketplace.json does not list a plugin named "${manifest.name}"`);
  } else {
    const source = resolve(ROOT, entry.source ?? '');
    if (!existsSync(source)) {
      fail(`marketplace.json: source "${entry.source}" does not exist`);
    } else if (source !== PLUGIN) {
      fail(`marketplace.json: source "${entry.source}" does not point at plugin/`);
    }
  }
}

// -- 2. Every MCP server the plugin declares is shippable ------------------

// The failure this catches: a path that works here and nowhere else. An
// installed plugin is a copied directory — anything reached via `../` or left
// untracked is simply not there.
const mcpConfigRef = manifest?.mcpServers;
const mcpPath = join(PLUGIN, '.mcp.json');
const mcpConfig = existsSync(mcpPath) ? readJson(mcpPath) : null;

if (typeof mcpConfigRef === 'string' && resolve(PLUGIN, mcpConfigRef) !== mcpPath) {
  fail(`plugin.json: mcpServers points at "${mcpConfigRef}", expected ./.mcp.json`);
}

const bundles = [];
if (mcpConfig) {
  for (const [name, server] of Object.entries(mcpConfig.mcpServers ?? {})) {
    for (const arg of server.args ?? []) {
      if (!arg.includes('${CLAUDE_PLUGIN_ROOT}')) continue;

      const rest = arg.slice(arg.indexOf('${CLAUDE_PLUGIN_ROOT}') + '${CLAUDE_PLUGIN_ROOT}'.length);
      const target = resolve(PLUGIN, `.${rest}`);

      if (!target.startsWith(PLUGIN + '/')) {
        fail(`.mcp.json [${name}]: "${arg}" escapes the plugin root — an install will not copy it`);
        continue;
      }
      if (!existsSync(target)) {
        fail(`.mcp.json [${name}]: "${arg}" resolves to a missing file (${relative(ROOT, target)})`);
        continue;
      }
      if (!isTracked(target)) {
        fail(`.mcp.json [${name}]: ${relative(ROOT, target)} exists but is untracked — a clone will not have it`);
        continue;
      }
      bundles.push({ name, target });
    }
  }
}

// -- 3. Skills, agents and commands are present and have frontmatter -------

// These are plain markdown and always ship, but a missing frontmatter `name`
// makes Claude Code skip the file silently rather than error.
const markdownDirs = [
  ['skills', join(PLUGIN, 'skills'), 'SKILL.md'],
  ['agents', join(PLUGIN, 'agents'), null],
  ['commands', join(PLUGIN, 'commands'), null],
];
for (const [label, dir, requiredFile] of markdownDirs) {
  if (!existsSync(dir)) continue;
  const files = execFileSync('git', ['ls-files', relative(ROOT, dir)], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.md'));
  if (files.length === 0) fail(`plugin/${label}/ exists but tracks no .md files`);
  for (const file of files) {
    if (requiredFile && !file.endsWith(requiredFile)) continue;
    const body = readFileSync(join(ROOT, file), 'utf8');
    if (!body.startsWith('---')) fail(`${file}: missing YAML frontmatter`);
    else if (!/^name:\s*\S/m.test(body.slice(0, body.indexOf('---', 3))))
      fail(`${file}: frontmatter has no "name"`);
  }
}

// -- 4. The bundle actually boots with no node_modules ---------------------

/**
 * Copies the bundle alone into an empty directory and speaks MCP to it. This
 * is the check that matters: it reproduces the install environment, where
 * nothing but the copied file exists. A bundle that forgot to inline a
 * dependency passes every static check above and dies here.
 */
async function bootCheck({ name, target }) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-plugin-'));
  try {
    const isolated = join(dir, 'server.bundle.js');
    copyFileSync(target, isolated);

    const proc = spawn(process.execPath, [isolated], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Deliberately no NODE_PATH: resolution must not reach the repo's store.
      env: { PATH: process.env.PATH ?? '' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '1' } },
      }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'
    );

    const exited = await new Promise((done) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); done('timeout'); }, 30000);
      proc.on('exit', (code) => { clearTimeout(timer); done(code); });
      proc.on('error', (err) => { clearTimeout(timer); done(err.message); });
      // The server holds stdio open; end input so it can finish.
      setTimeout(() => proc.stdin.end(), 1500);
    });

    const replies = stdout.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const listed = replies.find((r) => r.id === 2)?.result?.tools;
    if (!listed?.length) {
      fail(
        `.mcp.json [${name}]: bundle did not answer tools/list when run alone ` +
        `(exit=${exited})${stderr ? `\n  stderr: ${stderr.trim().slice(0, 400)}` : ''}`
      );
    } else {
      console.log(`  ${name}: boots standalone, exposes ${listed.length} tools`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('==> check-plugin: validating plugin/ is installable');
for (const bundle of bundles) await bootCheck(bundle);

if (failures.length) {
  console.error(`\ncheck-plugin: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-plugin: ok');
