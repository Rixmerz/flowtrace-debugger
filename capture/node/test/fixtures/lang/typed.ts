export class Typed {
  greet(name: string): string {
    return `hi ${name}`;
  }
}
new Typed().greet('x');
