# FastAPI Bugged — FlowTrace v2 demo

3 intentional bugs across stack levels. FlowTrace + MCP locate each.

## Bugs

| Level | File | Bug |
|---|---|---|
| L3 data | `app/repository.py:15` | SKU `BUG_42` missing `price` key → `KeyError` |
| L2 logic | `app/pricing.py:21` | `_tax(qty)` should be `_tax(discounted)` |
| L1 api | `app/api.py` | `_validate_qty` raises but no FastAPI handler maps it |

## Run

```bash
PYTHONPATH=$PWD:<repo>/capture/python:<repo>/capture/python/stub \
FLOWTRACE_ENABLE=1 \
FLOWTRACE_PACKAGE_PREFIX=app \
FLOWTRACE_OUTPUT=/tmp/demo-trace.jsonl \
python3 run_scenarios.py
```

## Locate bugs via MCP

```
log_open path=/tmp/demo-trace.jsonl     → sessionId
trace_find_error sessionId=...           → L3 path + line
log_search sessionId=... filter=_tax     → L2 args reveal qty vs subtotal
trace_tree sessionId=... trace_id=...    → full call tree per scenario
```

## Result

- L3 located exact: `repository.py:15` `record["price"]`
- L2 located: `_tax(amount=2)` when subtotal was 20.0 — wrong arg
- Trace structure shows visibility (private `_*`), depth, durations
