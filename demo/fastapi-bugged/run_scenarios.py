"""Driver: 3 scenarios stress 3 bug levels.

L1 happy: SKU_001 qty=2 — exposes L2 tax-bug (wrong total but no crash)
L2 wrong-discount: SKU_001 qty=10 — discount + tax-bug
L3 crash: BUG_42 qty=1 — crashes inside _read_price (KeyError 'price')
"""
import json
import sys
import traceback

from app.pricing import compute_total


def scenario(name: str, sku: str, qty: int):
    try:
        total = compute_total(sku, qty)
        print(f"{name}: total={total}")
    except Exception as e:
        print(f"{name}: CRASH {type(e).__name__}: {e}")


def main():
    scenario("happy", "SKU_001", 2)
    scenario("discount", "SKU_001", 10)
    scenario("crash_l3", "BUG_42", 1)


if __name__ == "__main__":
    main()
