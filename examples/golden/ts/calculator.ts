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

// Plain function: exercises class:"" (no enclosing class).
export function describe(label: string): string {
  return `calc:${label}`;
}

// Error path: exercises the exit event's `error` + `result` shape.
export function mustFail(): void {
  throw new TypeError('golden failure');
}

// Executed on import rather than behind `require.main === module`. That guard is
// a CommonJS idiom, and a .ts file is loaded as ESM, where `require` does not
// exist — so merely evaluating `require.main` threw a ReferenceError and this
// fixture could not be loaded at all, in either module system. Node cannot use a
// .ts file as an entry point either, so "run on import" is the only shape that
// actually executes.
// eslint-disable-next-line no-console
console.log(new Calculator().run());
// eslint-disable-next-line no-console
console.log(describe('golden'));
try {
  mustFail();
} catch {
  // Swallowed on purpose: the fixture must exit 0 so the harness can compare its
  // output, while still producing an error exit event to validate.
}
