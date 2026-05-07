/**
 * `flowtrace run` (v2) — stub: aún no instrumenta capture/. Acepta `--lang`
 * y reserva ruta de salida `.flowtrace/<ISO>.jsonl`. La integración real con
 * los capture layers aterriza en S2 (Java), S3 (Python), S4 (Node/TS).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const SUPPORTED_LANGS = new Set(['java', 'python', 'node', 'ts']);

async function runCommand(options = {}, restArgs = []) {
  const cwd = process.cwd();
  const cfgPath = path.join(cwd, '.flowtrace', 'config.json');

  if (!fs.existsSync(cfgPath)) {
    console.error(chalk.red('Error:'), 'FlowTrace no está inicializado.');
    console.log(chalk.gray('Ejecuta: flowtrace init'));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

  const lang = options.lang || config.lang || 'auto';
  if (lang !== 'auto' && !SUPPORTED_LANGS.has(lang)) {
    console.error(chalk.red('Error:'), `Lenguaje no soportado: ${lang}`);
    console.log(chalk.gray(`Soportados: ${[...SUPPORTED_LANGS].join(', ')}`));
    process.exit(2);
  }

  const outDir = path.join(cwd, '.flowtrace');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = options.out || path.join(outDir, `${stamp}.jsonl`);

  console.log(chalk.cyan('FlowTrace v2 run (stub)'));
  console.log(chalk.gray(`  lang  : ${lang}`));
  console.log(chalk.gray(`  out   : ${outPath}`));
  console.log(chalk.gray(`  args  : ${restArgs.join(' ') || '(none)'}`));
  console.log(chalk.yellow('  capture layers aún no implementados (S2-S4).'));

  return { lang, outPath, args: restArgs };
}

module.exports = runCommand;
