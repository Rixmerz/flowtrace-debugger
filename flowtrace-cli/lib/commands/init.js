/**
 * `flowtrace init` (v2) — escribe .flowtrace/config.json con marker schema v2.
 * Stub mínimo. La detección real de lenguaje aterriza en Sprint 5.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { ensureGitignore } = require('../gitignore');
const { detectLang, detectPackagePrefix } = require('../detect');

const SCHEMA_ID = 'https://flowtrace.dev/schema/flowtrace-v2.json';

async function initCommand(options = {}) {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.flowtrace');
  const cfgPath = path.join(dir, 'config.json');

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Detect lang if not explicitly provided
  let lang = options.lang || null;
  let packagePrefix = null;
  if (!lang) {
    const detected = detectLang(cwd);
    if (Array.isArray(detected)) {
      lang = detected[0]; // pick first on init; user can override with --lang
      console.log(chalk.yellow('Aviso:'), `Detectados varios lenguajes (${detected.join(', ')}). Usando: ${lang}. Usa --lang para especificar.`);
    } else {
      lang = detected || 'auto';
    }
  }
  if (lang && lang !== 'auto') {
    packagePrefix = detectPackagePrefix(cwd, lang);
  }

  const config = {
    schema: SCHEMA_ID,
    schemaVersion: 'v2',
    lang,
    capture: {
      packagePrefix,
      maxArgLength: 512,
    },
    output: {
      dir: '.flowtrace',
      filenamePattern: '<ISO>.jsonl',
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Shared with `run` — see lib/gitignore.js. A trace records argument values,
  // so leaving it committable is a data-exposure problem, not untidiness.
  const gi = ensureGitignore(cwd);

  console.log(chalk.green('OK'), `FlowTrace v2 inicializado en ${cfgPath}`);
  console.log(chalk.gray(`  lang   : ${lang}`));
  if (packagePrefix) console.log(chalk.gray(`  prefix : ${packagePrefix}`));
  if (gi.changed) console.log(chalk.gray(`  ignore : .flowtrace/ añadido a ${gi.file}`));
  return config;
}

module.exports = initCommand;
