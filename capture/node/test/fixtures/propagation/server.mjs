/**
 * Instrumented one-shot HTTP server fixture.
 *
 * Closes itself after the first request so the event loop drains and the
 * emitter's beforeExit flush runs — the log is therefore complete by the time
 * the test reads it, without needing a signal or a sleep.
 */

import http from 'node:http';

export function buildGreeting(name) {
  return `hello ${name}`;
}

const server = http.createServer((req, res) => {
  const body = buildGreeting('world');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(body);
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`READY ${server.address().port}\n`);
});
