'use strict';
// Error-path golden fixture — Node.
//
// Two traced frames deep so the fixture asserts more than "a throw is
// recorded": inner() raises, outer() does not catch, so BOTH exit events must
// carry the error. An agent that only tagged the frame where the throw
// originated would still pass a single-frame fixture.
//
// The try/catch sits at module level, outside any traced function, so the
// process exits 0 and the trace contains exactly two enter/exit pairs.

function inner(n) {
  throw new RangeError(`inner refused ${n}`);
}

function outer(n) {
  return inner(n);
}

try {
  outer(7);
} catch (err) {
  console.log(`caught: ${err.message}`);
}
