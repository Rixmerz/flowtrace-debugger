/**
 * `flowtrace analyze` (v2) — abre el dashboard sobre un archivo JSONL.
 * --last (default): usa el JSONL más reciente en .flowtrace/
 * <file>          : ruta explícita
 * Lanza el dashboard server y abre el navegador automáticamente.
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

/** One HTTP request, resolved as {status, body} or null when it never landed. */
function request(baseUrl, { pathname, method = 'POST', headers = {}, body }) {
  return new Promise((resolve) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, body: parsed, text });
        });
      }
    );
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * POSTs `{filePath}` to `${baseUrl}/api/analyze-file` and resolves with the
 * returned `analysisId`.
 *
 * The dashboard only reads paths inside its allowed roots (its own working
 * directory plus FLOWTRACE_DASHBOARD_ROOTS) and answers 403 with
 * `code: "OUTSIDE_ROOTS"` for anything else. That is not a failure to report
 * — it is the server saying "hand me the bytes instead", so this uploads the
 * file. Any other failure resolves null and the caller opens the dashboard
 * empty rather than blocking on it.
 */
async function postAnalyzeFile(baseUrl, filePath) {
  const body = JSON.stringify({ filePath });
  const res = await request(baseUrl, {
    pathname: '/api/analyze-file',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  if (!res) return null;
  if (res.status === 403 && res.body && res.body.code === 'OUTSIDE_ROOTS') {
    return uploadForAnalysis(baseUrl, filePath);
  }
  if (res.status < 200 || res.status >= 300) return null;
  return (res.body && res.body.analysisId) || null;
}

/**
 * multipart/form-data upload to /api/analyze, hand-built so the CLI keeps its
 * dependency list unchanged for one request shape.
 */
async function uploadForAnalysis(baseUrl, filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  const boundary = `----flowtrace${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\n` +
    'Content-Type: application/jsonl\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, content, tail]);
  const res = await request(baseUrl, {
    pathname: '/api/analyze',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
  if (!res || res.status < 200 || res.status >= 300) return null;
  return (res.body && res.body.analysisId) || null;
}

/** Ids are server-minted; anything else does not belong in a URL we open. */
const ANALYSIS_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Pre-loads `target` into the running dashboard server and returns the URL
 * to open — `?analysis=<id>` on success, or the bare `baseUrl` (with a
 * stderr warning) if the pre-load fails for any reason. A failed pre-load
 * must never block opening the dashboard.
 */
async function buildOpenUrl(baseUrl, target) {
  const analysisId = await postAnalyzeFile(baseUrl, target);
  if (!analysisId) {
    console.error(chalk.yellow('Aviso:'), 'No se pudo pre-cargar la traza en el dashboard; abriendo vacío.');
    return baseUrl;
  }
  if (!ANALYSIS_ID_RE.test(analysisId)) {
    // The value comes back over HTTP and ends up in a URL handed to the
    // shell on Windows (`cmd /c start`), where `&` is a command separator.
    console.error(chalk.yellow('Aviso:'), 'El dashboard devolvió un id inesperado; abriendo vacío.');
    return baseUrl;
  }
  return `${baseUrl}?analysis=${encodeURIComponent(analysisId)}`;
}

async function analyzeCommand(file, options = {}) {
  const cwd = process.cwd();
  let target = file;

  // Resolve target file
  if (!target || options.last) {
    target = findLatestJsonl(path.join(cwd, '.flowtrace'));
    if (!target) {
      console.error(chalk.red('Error:'), 'No se encontró ningún JSONL en .flowtrace/');
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
    console.error(chalk.red('Error:'), 'No se encontró el dashboard.');
    console.log(chalk.gray('Reinstala @rixmerz/flowtrace, o si estás en el checkout corre `make bundle-dashboard`.'));
    process.exit(1);
  }

  const PORT = process.env.FLOWTRACE_DASHBOARD_PORT || 8765;
  const url = `http://localhost:${PORT}`;

  console.log(chalk.cyan('FlowTrace analyze'));
  console.log(chalk.gray(`  archivo : ${target}`));
  console.log(chalk.gray(`  dashboard: ${url}`));

  // AC3: never spawn a second server, and never open a second browser tab —
  // a server that is already running means some earlier invocation already
  // opened one. Pre-load the trace so the URL is ready, but only print it.
  if (await checkHealth(`${url}/health`)) {
    console.log(chalk.green('OK'), `Dashboard ya está corriendo en ${url}`);
    const openUrl = await buildOpenUrl(url, target);
    console.log(chalk.cyan('El dashboard ya estaba corriendo — mira esta traza en:'), openUrl);
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
      analyzeCommand._openBrowser(await buildOpenUrl(url, target));
    } else {
      console.error(chalk.red('Error:'), 'El dashboard no respondió a tiempo.');
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
analyzeCommand._uploadForAnalysis = uploadForAnalysis;
analyzeCommand._buildOpenUrl = buildOpenUrl;

module.exports = analyzeCommand;
