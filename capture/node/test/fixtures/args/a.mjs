export function take(v) { return 1; }
const circular = { name: 'loop' }; circular.self = circular;
class Point { constructor(x) { this.x = x; } }
take(undefined);
take(null);
take(new Error('boom'));
take(new Map([['a', 1]]));
take(new Set([1, 2]));
take(new Date('2020-01-02T03:04:05Z'));
take(10n);
take(Symbol('sym'));
take(function named() { return 42; });
take(circular);
take(new Point(7));
take(NaN);
take(Infinity);
