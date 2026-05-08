"""Runtime helpers injected into instrumented modules as __ft_enter / __ft_exit / __ft_exit_error.

These are NOT imported by user code — they are injected into module globals
by FlowtraceSourceLoader.exec_module before the module code executes.
"""

from __future__ import annotations

import json
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


def _to_json_safe(v: Any) -> Any:
    """Convert a value to something JSON-serializable."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (list, tuple)):
        return [_to_json_safe(i) for i in v]
    if isinstance(v, dict):
        return {str(k): _to_json_safe(vv) for k, vv in v.items()}
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

    if isinstance(result, dict):
        result_val = result
    elif result is None:
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
