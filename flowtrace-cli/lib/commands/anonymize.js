/**
 * `flowtrace anonymize <file>` — reemplaza cada valor capturado por un hash
 * para poder compartir la traza. Ver lib/anonymize.js.
 */
'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { readJsonl } = require('../jsonl');
const { anonymizeEvents } = require('../anonymize');

module.exports = async function anonymize(file, options) {
  const events = readJsonl(file);
  const out = anonymizeEvents(events, {
    salt: options.salt,
    names: Boolean(options.names),
    hashNumbers: Boolean(options.numbers),
  });
  const target = options.out || file.replace(/\.jsonl$/, '') + '.anon.jsonl';
  if (target === file) throw new Error('--out no puede ser el mismo archivo de entrada');
  fs.writeFileSync(target, out.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.error(chalk.green('✓'), `${out.length} eventos anonimizados → ${target}`);
  if (!options.salt) {
    console.error(chalk.gray('  Salt aleatorio: los hashes no coinciden con otra corrida. Usa --salt para comparar dos trazas.'));
  }
};
