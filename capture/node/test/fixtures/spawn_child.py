"""Cross-process fixture: a Python child spawned by a traced Node parent.

Emits one root span using whatever context the runtime seeded from the
environment. Sets nothing itself — that is the point.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.environ["FLOWTRACE_PY_PKG"])

from flowtrace_runtime.context import (  # noqa: E402
    current_span_id,
    current_trace_id,
    seed_from_environment,
)
from flowtrace_runtime.ids import new_span_id  # noqa: E402

seed_from_environment()

parent_id = current_span_id.get() or None
trace_id = current_trace_id.get()

event = {
    "ts": time.time(),
    "trace_id": trace_id,
    "span_id": new_span_id(),
    "parent_id": parent_id,
    "event": "enter",
    "thread": "MainThread",
    "lang": "python",
    "module": "child",
    "class": "",
    "method": "work",
    "visibility": "public",
    "args": {},
    "depth": 0,
}
with open(os.environ["FLOWTRACE_OUTPUT"], "a", encoding="utf-8") as fh:
    fh.write(json.dumps(event) + "\n")
