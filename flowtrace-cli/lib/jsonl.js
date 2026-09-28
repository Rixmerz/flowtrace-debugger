'use strict';

const fs = require('fs');

/** Parse a JSONL trace, failing with the line number of the first bad line. */
function readJsonl(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`${file}:${i + 1}: JSON inválido (${err.message})`);
    }
  });
  return out;
}

module.exports = { readJsonl };
