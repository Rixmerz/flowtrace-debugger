/**
 * `flowtrace analyze` (v2) — abre el dashboard sobre un archivo JSONL.
 * --last (default): usa el JSONL mas reciente en .flowtrace/
 * <file>          : ruta explicita
 * Lanza el dashboard server y abre el navegador automaticamente.
 */
'use strict';

const fs      = require('fs');
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

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..'); // <repo>
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

  const serverJs = path.join(repoRoot(), 'flowtrace-dashboard', 'server', 'server.js');
  if (!fs.existsSync(serverJs)) {
    console.error(chalk.red('Error:'), `No se encontro el dashboard: ${serverJs}`);
    console.log(chalk.gray('Asegurate de que flowtrace-dashboard/server/server.js existe.'));
    process.exit(1);
  }

  const PORT = process.env.FLOWTRACE_DASHBOARD_PORT || 8765;
  const url = `http://localhost:${PORT}`;

  console.log(chalk.cyan('FlowTrace analyze'));
  console.log(chalk.gray(`  archivo : ${target}`));
  console.log(chalk.gray(`  dashboard: ${url}`));
  console.log(chalk.gray('Iniciando servidor de dashboard...'));

  const env = { ...process.env, PORT: String(PORT), FLOWTRACE_FILE: target };
  const child = spawn(process.execPath, [serverJs], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for server ready signal then open browser
  let ready = false;
  const onData = (data) => {
    const text = data.toString();
    process.stdout.write(chalk.gray(text));
    if (!ready && text.includes('localhost')) {
      ready = true;
      console.log(chalk.green('OK'), `Dashboard listo en ${url}`);
      openBrowser(url);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', (d) => process.stderr.write(chalk.gray(d.toString())));

  // Forward Ctrl-C
  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
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

module.exports = analyzeCommand;
