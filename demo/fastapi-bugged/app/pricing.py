"""L2 — business logic. Bug: tax computed on quantity, not subtotal."""

from app.repository import get_price


def _tax(amount: float) -> float:
    return amount * 0.21


def _apply_discount(subtotal: float, qty: int) -> float:
    if qty >= 10:
        return subtotal * 0.9
    return subtotal


def compute_total(sku: str, qty: int) -> float:
    price = get_price(sku)
    subtotal = price * qty
    discounted = _apply_discount(subtotal, qty)
    # BUG: should be _tax(discounted), not _tax(qty)
    tax = _tax(qty)
    return discounted + tax
