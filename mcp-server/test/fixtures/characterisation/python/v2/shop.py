"""Characterisation fixture, changed version.

A small order flow traced by mcp-server/test/test-behavior-diff-capture.mjs.
v2/shop.py is this file with ONE behaviour changed (Pricing.label); the test
asserts the behavioural diff names that and nothing else.

Deliberately includes what makes two runs of the same code differ on disk:
an object passed by reference (its default repr embeds a memory address), a
wall-clock value and a random id (both ignored by key in the test).
"""
import time
import uuid


class Cart:
    def __init__(self, items):
        self.items = items


class Pricing:
    def total(self, cart):
        return sum(self.line(price, qty) for price, qty in cart.items)

    def line(self, price, qty):
        return price * qty

    def label(self, total):
        return f"Total: {total}"


class Orders:
    def __init__(self):
        self.pricing = Pricing()

    def create(self, cart):
        total = self.pricing.total(cart)
        self.pricing.label(total)
        return self.stamp({"total": total})

    def stamp(self, order):
        return {**order, "id": str(uuid.uuid4()), "created_at": time.time()}


if __name__ == "__main__":
    Orders().create(Cart([(10, 2), (5, 3)]))
