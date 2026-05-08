'use strict';
// FlowTrace v2 benchmark — 10k hot-loop, add() calls _validate() each iteration.

function _validate(x) {
  if (x < 0) throw new Error('negative: ' + x);
}

function add(x, y) {
  _validate(x);
  return x + y;
}

function runHotLoop() {
  let acc = 0;
  for (let i = 0; i < 10_000; i++) {
    acc += add(i, 1);
  }
  // Prevent dead-code elimination.
  if (acc < 0) process.stderr.write('unreachable:' + acc + '\n');
}

// Warm-up (not measured).
for (let i = 0; i < 500; i++) {
  add(i, 1);
}

const start = process.hrtime.bigint();
runHotLoop();
const end = process.hrtime.bigint();

const elapsedMs = Number((end - start) / 1_000_000n);
console.log(`BENCH_RESULT_MS=${elapsedMs}`);
