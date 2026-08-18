// Minimal TypeScript sample for FlowTrace v2 golden fixture.
// Call tree: run() -> add(a, b) -> #validate(x) (TS private + JS private field).
// No FlowTrace imports / decorators / tsconfig flags: zero source modification.

export class Calculator {
  run(): number {
    return this.add(2, 3);
  }

  add(a: number, b: number): number {
    this.#validate(a);
    this.#validate(b);
    return a + b;
  }

  #validate(x: number): void {
    if (x < 0) {
      throw new Error(`negative: ${x}`);
    }
  }
}

// Invoked directly by the golden harness. No `require.main === module` guard:
// the capture loads .ts through the ESM loader, where `require` is undefined.
// eslint-disable-next-line no-console
console.log(new Calculator().run());
