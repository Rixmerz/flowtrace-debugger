// Characterisation fixture, baseline version.
//
// A small order flow traced by mcp-server/test/test-behavior-diff-capture.mjs.
// v2/shop.js is this file with ONE behaviour changed (Pricing.label); the test
// asserts the behavioural diff names that and nothing else.
//
// Deliberately includes what makes two runs of the same code differ on disk:
// a wall-clock value and a random id (both ignored by key in the test).
const { randomUUID } = require('node:crypto');

class Pricing {
  total(cart) {
    let sum = 0;
    for (const [price, qty] of cart.items) sum += this.line(price, qty);
    return sum;
  }

  line(price, qty) {
    return price * qty;
  }

  label(total) {
    return `TOTAL ${total}`;
  }
}

class Orders {
  constructor() {
    this.pricing = new Pricing();
  }

  create(cart) {
    const total = this.pricing.total(cart);
    this.pricing.label(total);
    return this.stamp({ total });
  }

  stamp(order) {
    return { ...order, id: randomUUID(), created_at: Date.now() };
  }
}

new Orders().create({ items: [[10, 2], [5, 3]] });
