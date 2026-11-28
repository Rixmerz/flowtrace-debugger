// Characterisation fixture: an async flow whose sibling order is scheduling.
//
// Each task awaits a random timer before calling `square`, so the order in
// which the `square` calls happen differs from run to run. The test uses it to
// pin down what two runs of unchanged concurrent code compare as.
const { setTimeout: sleep } = require('node:timers/promises');

async function fetchOne(n) {
  await sleep(Math.random() * 20);
  return square(n);
}

function square(n) {
  return n * n;
}

async function run() {
  const all = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((n) => fetchOne(n)));
  return all.reduce((a, b) => a + b, 0);
}

run();
