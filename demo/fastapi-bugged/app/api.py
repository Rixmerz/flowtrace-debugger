"""L1 — API layer. Endpoint orchestrates pricing call."""

from fastapi import FastAPI, HTTPException
from app.pricing import compute_total

app = FastAPI()


def _validate_qty(qty: int) -> None:
    if qty <= 0:
        raise ValueError("qty must be positive")


@app.get("/quote/{sku}")
def quote(sku: str, qty: int = 1):
    _validate_qty(qty)
    total = compute_total(sku, qty)
    return {"sku": sku, "qty": qty, "total": total}
