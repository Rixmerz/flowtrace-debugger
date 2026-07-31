export function inner() { throw new TypeError('kaboom'); }
export function outer() { return inner(); }
try { outer(); } catch { /* observed via trace */ }
