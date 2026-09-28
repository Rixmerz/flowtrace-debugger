/**
 * `flowtrace export <file>` — convierte la traza a OTLP/JSON para abrirla en
 * Jaeger, Tempo o cualquier backend OTLP. Escribe un archivo o, con
 * --endpoint, la envía por OTLP/HTTP.
 */
'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { readJsonl } = require('../jsonl');
const { toOtlp } = require('../otlp');

function parseEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`--endpoint inválido: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--endpoint debe ser http(s): ${raw}`);
  }
  // The conventional OTLP/HTTP collector address is the bare host:4318; accept
  // it and append the signal path the spec defines.
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1/traces';
  return url;
}

module.exports = async function exportCmd(file, options) {
  const payload = toOtlp(readJsonl(file), { serviceName: options.service });
  const spanCount = payload.resourceSpans.reduce((n, r) => n + r.scopeSpans[0].spans.length, 0);
  const body = JSON.stringify(payload);

  if (options.endpoint) {
    const url = parseEndpoint(options.endpoint);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${url.href} respondió ${res.status}: ${text.slice(0, 300)}`);
    }
    console.error(chalk.green('✓'), `${spanCount} spans enviados a ${url.href}`);
    return;
  }

  const target = options.out || file.replace(/\.jsonl$/, '') + '.otlp.json';
  fs.writeFileSync(target, body);
  console.error(chalk.green('✓'), `${spanCount} spans → ${target}`);
};

module.exports.parseEndpoint = parseEndpoint;
