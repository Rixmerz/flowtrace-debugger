"""Runtime helpers injected into instrumented modules as __ft_enter / __ft_exit / __ft_exit_error.

These are NOT imported by user code — they are injected into module globals
by FlowtraceSourceLoader.exec_module before the module code executes.
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
import traceback
from typing import Any

from .context import current_depth, current_span_id, current_trace_id, enter_span, exit_span
from .emitter import Emitter
from .ids import new_span_id, new_trace_id


def _get_max_arg_length() -> int:
    """Read FLOWTRACE_MAX_ARG_LENGTH env var. 0 = no truncation. Default 512."""
    raw = os.environ.get("FLOWTRACE_MAX_ARG_LENGTH", "512")
    try:
        return max(0, int(raw))
    except ValueError:
        return 512


def _truncate_if_needed(serialized: Any) -> Any:
    """If JSON representation exceeds max-arg-length, replace with truncation marker."""
    max_len = _get_max_arg_length()
    if max_len == 0:
        return serialized
    try:
        s = json.dumps(serialized, separators=(",", ":"))
    except Exception:
        s = repr(serialized)
    if len(s) > max_len:
        return f"<truncated:{s[:max_len]}...>"
    return serialized


def _serialize_args(locals_dict: dict[str, Any]) -> dict[str, Any]:
    """Convert locals dict to a JSON-safe args dict, skipping self/cls."""
    result: dict[str, Any] = {}
    for k, v in locals_dict.items():
        if k in ("self", "cls", "_ft_ctx", "_ft_result", "_ft_exc"):
            continue
        result[k] = _truncate_if_needed(_to_json_safe(v))
    return result


#: Maximum nesting depth walked when serializing an argument. Beyond this the
#: value is elided. Cycle detection alone is not enough: a deeply nested but
#: acyclic structure would still be walked to exhaustion.
_MAX_DEPTH = 8


def _to_json_safe(v: Any, _seen: frozenset[int] = frozenset(), _depth: int = 0) -> Any:
    """Convert a value to something JSON-serializable.

    Two things here are not defensive niceties; both were real failures:

    - **Non-finite floats.** ``json.dumps`` emits bare ``NaN`` / ``Infinity``,
      which Python's own parser accepts as a non-standard extension but which is
      NOT valid JSON. Every consumer in this repository is JavaScript, and
      ``JSON.parse`` rejects both — so a single NaN in an argument invalidated the
      entire event line for the MCP server, the dashboard analyzer and the schema
      validator alike. They are emitted as strings, which is valid and preserves
      the information.

    - **Cycles.** This function used to recurse unconditionally, so a structure
      containing a reference to itself raised RecursionError *inside the traced
      program*. Instrumentation crashing the program it is observing is the worst
      outcome available, and self-referential structures are ordinary: parent/child
      trees, ORM back-references, self-referential config.

    ``_seen`` is threaded per PATH rather than shared across the whole walk, so a
    value legitimately appearing twice in sibling branches (a DAG) is serialized
    twice instead of being falsely reported as circular.
    """
    # bool is a subclass of int; both pass through unchanged.
    if v is None or isinstance(v, (bool, int, str)):
        return v

    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return v

    if isinstance(v, (list, tuple, dict)):
        if id(v) in _seen:
            return "<circular>"
        if _depth >= _MAX_DEPTH:
            return f"<max depth {_MAX_DEPTH}>"
        seen = _seen | {id(v)}
        if isinstance(v, dict):
            return {str(k): _to_json_safe(vv, seen, _depth + 1) for k, vv in v.items()}
        return [_to_json_safe(i, seen, _depth + 1) for i in v]

    return repr(v)


def _extract_class_method(qualname: str) -> tuple[str, str]:
    """Split 'Calculator.add' into ('Calculator', 'add'). Returns ('', name) if no class."""
    if "." in qualname:
        parts = qualname.rsplit(".", 1)
        return parts[0], parts[1]
    return "", qualname


def _ft_enter(
    module: str,
    qualname: str,
    locals_dict: dict[str, Any],
    visibility: str,
) -> dict:
    """Called at the start of every instrumented function. Returns a ctx dict."""
    parent_id: str | None = current_span_id.get() or None
    trace_id = current_trace_id.get() or new_trace_id()
    span_id = new_span_id()
    depth = current_depth.get()

    tokens = enter_span(trace_id, span_id)

    class_name, method_name = _extract_class_method(qualname)
    args = _serialize_args(locals_dict)

    emitter = Emitter.instance()
    emitter.emit({
        "ts": time.time(),
        "trace_id": trace_id,
        "span_id": span_id,
        "parent_id": parent_id,
        "event": "enter",
        "thread": threading.current_thread().name,
        "lang": "python",
        "module": module,
        "class": class_name,
        "method": method_name,
        "visibility": visibility,
        "args": args,
        "depth": depth,
    })

    return {
        "start_ns": time.perf_counter_ns(),
        "span_id": span_id,
        "trace_id": trace_id,
        "parent_id": parent_id,
        "module": module,
        "qualname": qualname,
        "class": class_name,
        "method": method_name,
        "visibility": visibility,
        "depth": depth,
        "args": args,
        "tokens": tokens,
    }


def _ft_exit(ctx: dict, result: Any) -> None:
    """Called after the function body completes normally."""
    duration_ns = time.perf_counter_ns() - ctx["start_ns"]

    # A dict return used to be emitted AS the result object, unwrapped and without
    # passing through _to_json_safe at all. Two problems: the shape disagreed with
    # Node and Java, which always wrap in {"value": ...}, so the same function
    # traced in two languages disagreed about what it returned; and skipping the
    # serializer meant a returned dict containing a cycle or a NaN reintroduced
    # both of the failures that function exists to prevent.
    if result is None:
        result_val = {}
    else:
        result_val = {"value": _to_json_safe(result)}

    Emitter.instance().emit({
        "ts": time.time(),
        "trace_id": ctx["trace_id"],
        "span_id": ctx["span_id"],
        "parent_id": ctx["parent_id"],
        "event": "exit",
        "thread": threading.current_thread().name,
        "lang": "python",
        "module": ctx["module"],
        "class": ctx["class"],
        "method": ctx["method"],
        "visibility": ctx["visibility"],
        "args": ctx["args"],
        "result": result_val,
        "duration_ns": duration_ns,
        "depth": ctx["depth"],
    })

    exit_span(ctx["tokens"])


def _ft_exit_error(ctx: dict, exc: BaseException) -> None:
    """Called when the function raises an exception."""
    duration_ns = time.perf_counter_ns() - ctx["start_ns"]

    tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    error_info = {
        "type": type(exc).__name__,
        "msg": str(exc),
        "stack": tb_lines[:20],
    }

    Emitter.instance().emit({
        "ts": time.time(),
        "trace_id": ctx["trace_id"],
        "span_id": ctx["span_id"],
        "parent_id": ctx["parent_id"],
        "event": "exit",
        "thread": threading.current_thread().name,
        "lang": "python",
        "module": ctx["module"],
        "class": ctx["class"],
        "method": ctx["method"],
        "visibility": ctx["visibility"],
        "args": ctx["args"],
        # The schema has a dedicated top-level `error` field, and `result` is
        # required separately. This used to emit result={"error": ...} and no
        # `error` field at all: schema-valid by luck, but every consumer that
        # looks for errors looks at `error` — the MCP server's trace.find_error
        # walks that field, so it could never find a Python failure. Java and
        # Node both use the top-level field.
        "result": {},
        "error": error_info,
        "duration_ns": duration_ns,
        "depth": ctx["depth"],
    })

    exit_span(ctx["tokens"])


# Expose as module-level names so loader can inject them by reference.
HELPERS: dict[str, Any] = {
    "_ft_enter": _ft_enter,
    "_ft_exit": _ft_exit,
    "_ft_exit_error": _ft_exit_error,
}
