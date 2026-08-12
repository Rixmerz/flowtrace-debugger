'use strict';
// Harness for the Express golden fixture: boot on an ephemeral port, issue one
// request, shut down. Deliberately outside the instrumented prefix so only
// app.js appears in the trace.

const { buildApp } = require('./app');

async function main() {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/orders/7`);
  const body = await res.json();
  console.log(JSON.stringify(body));

  await new Promise((resolve) => server.close(resolve));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
