/**
 * `flowtrace init` (v2) — escribe .flowtrace/config.json con marker schema v2.
 * Stub mínimo. La detección real de lenguaje aterriza en Sprint 5.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { detectLang, detectPackagePrefix, nodePackageName } = require('../detect');
const { ensureGitignore } = require('../gitignore');

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
      if (!options.yes) {
        // Picking silently is how a polyglot repo ends up configured for the
        // wrong runtime; ask unless the caller opted out with -y.
        const inquirer = require('inquirer');
        const { choice } = await inquirer.prompt([{
          type: 'list',
          name: 'choice',
          message: 'Se detectaron varios lenguajes. Selecciona:',
          choices: detected,
        }]);
        lang = choice;
      } else {
        lang = detected[0];
        console.log(chalk.yellow('Aviso:'), `Detectados varios lenguajes (${detected.join(', ')}). Usando: ${lang} (--yes). Usa --lang para especificar.`);
      }
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
      // `flowtrace run` reads these: the prefix takes precedence over
      // auto-detection, and maxArgLength is exported to every runtime.
      packagePrefix,
      maxArgLength: 512,
      ...(lang === 'node' || lang === 'ts'
        // For Node the prefix is a path (see detect.js); the package name is
        // recorded separately because it is what identifies the project.
        ? { packageName: nodePackageName(cwd) }
        : {}),
    },
    output: {
      dir: '.flowtrace',
      filenamePattern: '<ISO>.jsonl',
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Auto-add .flowtrace/ to .gitignore (idempotent, shared with `run`)
  ensureGitignore(cwd);

  console.log(chalk.green('OK'), `FlowTrace v2 inicializado en ${cfgPath}`);
  console.log(chalk.gray(`  lang   : ${lang}`));
  if (packagePrefix) console.log(chalk.gray(`  prefix : ${packagePrefix}`));
  return config;
}

module.exports = initCommand;
