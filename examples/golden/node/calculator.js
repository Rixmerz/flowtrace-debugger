// Minimal Node CJS sample for FlowTrace v2 golden fixture.
// Call tree: run() -> add(a,b) -> #validate(x) (private class field).
// No FlowTrace imports / decorators: zero source modification is the v2 contract.
//
// This fixture also covers two shapes it originally missed, each of which hid a
// real schema violation for an entire release:
//   - a PLAIN function (no enclosing class), which must emit class:"" — Node was
//     emitting class:null, invalid per the schema, and undetectable here while
//     every traced function was a method.
//   - an ERROR exit, which must carry both a top-level `error` and the required
//     `result` field.

class Calculator {
  run() {
    return this.add(2, 3);
  }

  add(a, b) {
    this.#validate(a);
    this.#validate(b);
    return a + b;
  }

  #validate(x) {
    if (x < 0) {
      throw new Error(`negative: ${x}`);
    }
  }
}

// Plain function: exercises class:"" (no enclosing class).
function describe(label) {
  return `calc:${label}`;
}

// Error path: exercises the exit event's `error` + `result` shape.
function mustFail() {
  throw new TypeError('golden failure');
}

if (require.main === module) {
  console.log(new Calculator().run());
  console.log(describe('golden'));
  try {
    mustFail();
  } catch {
    // Swallowed on purpose: the fixture must exit 0 so the harness can compare
    // its output, while still producing an error exit event to validate.
  }
}

module.exports = { Calculator, describe, mustFail };
