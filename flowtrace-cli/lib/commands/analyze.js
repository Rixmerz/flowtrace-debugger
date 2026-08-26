/**
 * `flowtrace analyze` (v2) — abre el dashboard sobre un archivo JSONL.
 * --last (default): usa el JSONL mas reciente en .flowtrace/
 * <file>          : ruta explicita
 * Lanza el dashboard server y abre el navegador automaticamente.
 */
'use strict';

const fs      = require('fs');
const http    = require('http');
const path    = require('path');
const { spawn } = require('child_process');
const chalk   = require('chalk');

function findLatestJsonl(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length > 0 ? path.join(dir, files[0].f) : null;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'darwin') {
    cmd = 'open'; args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd'; args = ['/c', 'start', url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // ignore — user can open manually
  }
}

/**
 * Locates the dashboard server, whichever of the two layouts this file is
 * running from:
 *
 *   installed package: flowtrace-cli/lib/commands/analyze.js ships alongside
 *   the committed esbuild bundle at flowtrace-cli/vendor/dashboard/server/
 *   server.bundle.js (see scripts/bundle-dashboard.mjs). This is the only
 *   layout that exists once the package is npm-installed.
 *
 *   monorepo / local dev: flowtrace-dashboard/ is a sibling of flowtrace-cli/
 *   in the checkout, so contributors testing `analyze` against source (no
 *   vendor build) fall back to flowtrace-dashboard/server/server.js.
 *
 * The old repoRoot() hardcoded '..','..','..' and only worked by coincidence
 * of the monorepo's own directory depth — nothing to fall back to once the
 * bundle (fixing "ship the dashboard at all") existed. This checks the
 * installed-package path first and only falls back for local dev.
 *
 * `baseDir` defaults to this file's own directory but is injectable so tests
 * can point it at a fixture tree instead of depending on this checkout's
 * ambient build state (whether `make bundle-dashboard` has run).
 */
function resolveDashboardServer(baseDir = __dirname) {
  const bundled = path.resolve(baseDir, '..', '..', 'vendor', 'dashboard', 'server', 'server.bundle.js');
  if (fs.existsSync(bundled)) return bundled;

  const fromSource = path.resolve(baseDir, '..', '..', '..', 'flowtrace-dashboard', 'server', 'server.js');
  if (fs.existsSync(fromSource)) return fromSource;

  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True only if a server is actually listening at `url`, answers 200, and its
 * body identifies it as the flowtrace dashboard (`{"service":"flowtrace-dashboard"}`)
 * — not just any process that happens to be on the port. Mirrors
 * flowtrace-dashboard/mcp-tools.js's own startDashboard() — probe before
 * spawn, so a second `flowtrace analyze` invocation reuses the first one's
 * server instead of spawning a redundant process or opening a tab at a
 * foreign server.
 */
function checkHealth(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(false);
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(body.service === 'flowtrace-dashboard');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** Polls /health until it succeeds or `retries` is exhausted. */
async function waitForHealth(url, { retries = 30, intervalMs = 200 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (await checkHealth(url)) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * POSTs `{filePath}` to `${baseUrl}/api/analyze-file` and resolves with the
 * returned `analysisId`, or `null` on any failure (bad JSON, non-2xx,
 * network error). Mirrors flowtrace-dashboard/mcp-tools.js's
 * openInDashboard(), which already does this against the same endpoint.
 */
function postAnalyzeFile(baseUrl, filePath) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ filePath });
    const { hostname, port, pathname } = new URL('/api/analyze-file', baseUrl);
    const req = http.request(
      {
        hostname,
        port,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parsed.analysisId || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

/**
 * Pre-loads `target` into the running dashboard server and returns the URL
 * to open — `?analysis=<id>` on success, or the bare `baseUrl` (with a
 * stderr warning) if the pre-load fails for any reason. A failed pre-load
 * must never block opening the dashboard.
 */
async function buildOpenUrl(baseUrl, target) {
  const analysisId = await postAnalyzeFile(baseUrl, target);
  if (!analysisId) {
    console.error(chalk.yellow('Warning:'), 'No se pudo pre-cargar el trace en el dashboard; abriendo vacio.');
    return baseUrl;
  }
  return `${baseUrl}?analysis=${analysisId}`;
}

async function analyzeCommand(file, options = {}) {
  const cwd = process.cwd();
  let target = file;

  // Resolve target file
  if (!target || options.last) {
    target = findLatestJsonl(path.join(cwd, '.flowtrace'));
    if (!target) {
      console.error(chalk.red('Error:'), 'No se encontro ningun JSONL en .flowtrace/');
      console.log(chalk.gray('Ejecuta primero: flowtrace run -- <cmd>'));
      process.exit(1);
    }
  }
  if (!fs.existsSync(target)) {
    console.error(chalk.red('Error:'), `Archivo no encontrado: ${target}`);
    process.exit(1);
  }

  target = path.resolve(target);

  const dashboardServer = resolveDashboardServer();
  if (!dashboardServer) {
    console.error(chalk.red('Error:'), 'No se encontro el dashboard.');
    console.log(chalk.gray('Reinstala @rixmerz/flowtrace, o si estas en el checkout corre `make bundle-dashboard`.'));
    process.exit(1);
  }

  const PORT = process.env.FLOWTRACE_DASHBOARD_PORT || 8765;
  const url = `http://localhost:${PORT}`;

  console.log(chalk.cyan('FlowTrace analyze'));
  console.log(chalk.gray(`  archivo : ${target}`));
  console.log(chalk.gray(`  dashboard: ${url}`));

  // AC3: never spawn a second server, and never open a browser tab before a
  // /health probe against a server that is actually listening succeeds — that
  // speculative open-before-verify sequence is exactly what produced repeated
  // ERR_CONNECTION_REFUSED tabs.
  if (await checkHealth(`${url}/health`)) {
    console.log(chalk.green('OK'), `Dashboard ya esta corriendo en ${url}`);
    openBrowser(await buildOpenUrl(url, target));
    return { file: target, exitCode: 0, reused: true };
  }

  console.log(chalk.gray('Iniciando servidor de dashboard...'));

  const env = { ...process.env, PORT: String(PORT) };
  const child = spawn(process.execPath, [dashboardServer], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write(chalk.gray(d.toString())));
  child.stderr.on('data', (d) => process.stderr.write(chalk.gray(d.toString())));

  // Forward Ctrl-C
  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });

  waitForHealth(`${url}/health`).then(async (ready) => {
    if (ready) {
      console.log(chalk.green('OK'), `Dashboard listo en ${url}`);
      openBrowser(await buildOpenUrl(url, target));
    } else {
      console.error(chalk.red('Error:'), 'El dashboard no respondio a tiempo.');
    }
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      resolve({ file: target, exitCode: code });
    });
  });
}

// Expose internals for testing
analyzeCommand._findLatestJsonl = findLatestJsonl;
analyzeCommand._openBrowser = openBrowser;
analyzeCommand._resolveDashboardServer = resolveDashboardServer;
analyzeCommand._checkHealth = checkHealth;
analyzeCommand._postAnalyzeFile = postAnalyzeFile;
analyzeCommand._buildOpenUrl = buildOpenUrl;

module.exports = analyzeCommand;
