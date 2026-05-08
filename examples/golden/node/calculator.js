// Minimal Node CJS sample for FlowTrace v2 golden fixture.
// Call tree: run() -> add(a,b) -> #validate(x) (private class field).
// No FlowTrace imports / decorators: zero source modification is the v2 contract.

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

if (require.main === module) {
  console.log(new Calculator().run());
}

module.exports = { Calculator };
