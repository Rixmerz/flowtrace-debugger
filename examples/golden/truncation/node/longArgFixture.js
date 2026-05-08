'use strict';
// Truncation golden fixture — Node.
// Calls a function with a 1000-char string argument.
// When run with FLOWTRACE_MAX_ARG_LENGTH=64, the arg must appear truncated in JSONL.

function process(data) {
  return `processed:${data.length}`;
}

const longArg = 'x'.repeat(1000);
const result = process(longArg);
console.log(`result=${result}`);
