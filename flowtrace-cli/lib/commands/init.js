/**
 * `flowtrace init` (v2) — escribe .flowtrace/config.json con marker schema v2.
 * Stub mínimo. La detección real de lenguaje aterriza en Sprint 5.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const SCHEMA_ID = 'https://flowtrace.dev/schema/flowtrace-v2.json';

async function initCommand(options = {}) {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.flowtrace');
  const cfgPath = path.join(dir, 'config.json');

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const config = {
    schema: SCHEMA_ID,
    schemaVersion: 'v2',
    lang: options.lang || 'auto',
    capture: {
      packagePrefix: null,
      maxArgLength: 512,
    },
    output: {
      dir: '.flowtrace',
      filenamePattern: '<ISO>.jsonl',
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  const giPath = path.join(cwd, '.gitignore');
  if (fs.existsSync(giPath)) {
    const gi = fs.readFileSync(giPath, 'utf-8');
    if (!/^\.flowtrace\/?$/m.test(gi)) {
      fs.appendFileSync(giPath, (gi.endsWith('\n') ? '' : '\n') + '.flowtrace/\n');
    }
  }

  console.log(chalk.green('OK'), `FlowTrace v2 inicializado en ${cfgPath}`);
  return config;
}

module.exports = initCommand;
