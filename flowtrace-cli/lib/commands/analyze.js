/**
 * `flowtrace analyze` (v2) — abre el dashboard sobre un archivo JSONL v2.
 * Para Sprint 1 el dashboard puede no estar corriendo: este comando se limita
 * a localizar el archivo, validar que parece v2, y delegar la visualización
 * al dashboard server (lanzado por separado vía `npm start` en
 * flowtrace-dashboard/). En S5 esto se vuelve transparente.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function findLatestJsonl(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length > 0 ? path.join(dir, files[0].f) : null;
}

function looksLikeV2(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf-8');
    const firstLine = head.split('\n').find((l) => l.trim());
    if (!firstLine) return false;
    const obj = JSON.parse(firstLine);
    return (
      typeof obj.trace_id === 'string' &&
      typeof obj.span_id === 'string' &&
      typeof obj.ts === 'number'
    );
  } catch {
    return false;
  }
}

async function analyzeCommand(file, options = {}) {
  const cwd = process.cwd();
  let target = file;
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
  if (!looksLikeV2(target)) {
    console.error(
      chalk.yellow('Aviso:'),
      `El archivo no parece schema v2 (sin trace_id/span_id/ts): ${target}`
    );
  }

  console.log(chalk.cyan('FlowTrace v2 analyze'));
  console.log(chalk.gray(`  file: ${target}`));
  console.log(chalk.gray('  abrir dashboard: cd flowtrace-dashboard && npm start'));
  return { file: target };
}

module.exports = analyzeCommand;
