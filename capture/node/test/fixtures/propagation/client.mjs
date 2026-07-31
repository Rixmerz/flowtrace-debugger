/**
 * Instrumented HTTP client fixture. Makes one outbound request, from inside an
 * instrumented function, so the active span is what gets propagated.
 */

import http from 'node:http';

export function fetchGreeting(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
  });
}

fetchGreeting(Number(process.argv[2])).then((body) => {
  process.stdout.write(`GOT ${body}\n`);
});
