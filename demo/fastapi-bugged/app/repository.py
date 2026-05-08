"""L3 — data layer. Bug: missing 'price' key for SKU 'BUG_42'."""

_DB = {
    "SKU_001": {"name": "widget", "price": 10.0, "stock": 5},
    "SKU_002": {"name": "gadget", "price": 25.0, "stock": 3},
    "BUG_42":  {"name": "broken", "stock": 1},  # BUG: no 'price' field
}


def find_sku(sku: str) -> dict:
    return _DB[sku]


def _read_price(record: dict) -> float:
    return record["price"]


def get_price(sku: str) -> float:
    record = find_sku(sku)
    return _read_price(record)
