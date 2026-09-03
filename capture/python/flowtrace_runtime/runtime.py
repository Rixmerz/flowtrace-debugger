"""Runtime helpers injected into instrumented modules as _ft_enter / _ft_exit / _ft_exit_error.

These are NOT imported by user code — they are injected into module globals
by FlowtraceSourceLoader.exec_module before the module code executes.

Nothing here may raise into the traced program. ``_ft_enter`` runs as the
first statement of every instrumented function and ``_ft_exit`` runs in its
``finally``; an exception escaping either would replace the program's own
behaviour with ours, so each helper catches everything and degrades to "this
span is not recorded".
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from typing import Any

from .context import current_depth, current_span_id, current_trace_id, enter_span, exit_span
from .emitter import Emitter
from .ids import new_span_id, new_trace_id

# ----------------------------------------------------------------------
# Configuration — resolved once. The knobs are environment set by `flowtrace
# run` before the interpreter starts; reading os.environ on every value was
# hot-path cost for constants. reset_config() exists for the test suite.
# ----------------------------------------------------------------------

_DEFAULT_MAX_ARG_LENGTH = 512

_DEFAULT_REDACT_KEYS = (
    "password,secret,token,authorization,api_key,url,dsn,connection_string,email"
)

_config: dict[str, Any] = {}


def reset_config() -> None:
    """Forget the cached env-derived configuration (tests)."""
    _config.clear()


def _get_max_arg_length() -> int:
    """FLOWTRACE_MAX_ARG_LENGTH: 0 = no truncation. Default 512."""
    if "max_arg_length" not in _config:
        raw = os.environ.get("FLOWTRACE_MAX_ARG_LENGTH", str(_DEFAULT_MAX_ARG_LENGTH))
        try:
            _config["max_arg_length"] = max(0, int(raw))
        except ValueError:
            _config["max_arg_length"] = _DEFAULT_MAX_ARG_LENGTH
    return _config["max_arg_length"]


def _get_redact_keys() -> list[str]:
    """Redact-key substrings matched case-insensitively against argument
    (and nested dict key) names. Always includes the default list covering
    common secret/PII-bearing names; FLOWTRACE_REDACT_KEYS, if set, is a
    comma-separated list of ADDITIONAL substrings appended to it — it does
    not replace the defaults."""
    if "redact_keys" not in _config:
        keys = [k.strip().lower() for k in _DEFAULT_REDACT_KEYS.split(",") if k.strip()]
        raw = os.environ.get("FLOWTRACE_REDACT_KEYS", "")
        for k in raw.split(","):
            k = k.strip().lower()
            if k and k not in keys:
                keys.append(k)
        _config["redact_keys"] = keys
    return _config["redact_keys"]


def _is_redacted_key(name: str, redact_keys: list[str]) -> bool:
    lowered = name.lower()
    return any(k in lowered for k in redact_keys)


# ----------------------------------------------------------------------
# Serialization
# ----------------------------------------------------------------------

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
    """Convert locals dict to a JSON-safe args dict, skipping self/cls and
    redacting values whose arg name matches FLOWTRACE_REDACT_KEYS (checked
    recursively, so a redact-key nested inside a dict value is also caught)."""
    redact_keys = _get_redact_keys()
    result: dict[str, Any] = {}
    for k, v in locals_dict.items():
        if k in ("self", "cls", "_ft_ctx", "_ft_result", "_ft_exc"):
            continue
        if redact_keys and _is_redacted_key(k, redact_keys):
            result[k] = "<redacted>"
            continue
        result[k] = _truncate_if_needed(_to_json_safe(v, redact_keys))
    return result


def _serialize_result(result: Any) -> dict[str, Any]:
    """``{}`` for None, ``{"value": X}`` otherwise — the same shape as the Node
    and Java layers. A dict return used to be emitted unwrapped, which made
    ``{"value": 1}`` returned by the program indistinguishable from ``1``."""
    if result is None:
        return {}
    value = _truncate_if_needed(_to_json_safe(result, _get_redact_keys()))
    return {"value": value}


def _to_json_safe(v: Any, redact_keys: list[str] | None = None) -> Any:
    """Convert a value to something JSON-serializable, redacting dict values
    whose key matches redact_keys at any nesting depth."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        # NaN/Infinity are not JSON; json.dumps would happily write them and
        # every strict parser downstream would reject the line.
        return v if v == v and v not in (float("inf"), float("-inf")) else repr(v)
    if isinstance(v, (list, tuple)):
        return [_to_json_safe(i, redact_keys) for i in v]
    if isinstance(v, dict):
        out: dict[str, Any] = {}
        for k, vv in v.items():
            sk = str(k)
            if redact_keys and _is_redacted_key(sk, redact_keys):
                out[sk] = "<redacted>"
            else:
                out[sk] = _to_json_safe(vv, redact_keys)
        return out
    try:
        return repr(v)
    except Exception:
        return f"<unrepresentable: {type(v).__name__}>"


def _extract_class_method(qualname: str) -> tuple[str, str]:
    """Split 'Calculator.add' into ('Calculator', 'add'). Returns ('', name) if no class."""
    if "." in qualname:
        parts = qualname.rsplit(".", 1)
        return parts[0], parts[1]
    return "", qualname


# ----------------------------------------------------------------------
# Failure containment
# ----------------------------------------------------------------------

_DEAD_CTX = {"dead": True}
_warned_internal = False


def _internal_failure(where: str) -> None:
    """Report an exception inside the instrumentation once, then stay quiet."""
    global _warned_internal
    if _warned_internal:
        return
    _warned_internal = True
    print(
        f"[flowtrace] WARNING: instrumentation failed in {where}; affected spans are not "
        "recorded (further occurrences are not printed)",
        file=sys.stderr,
    )
    traceback.print_exc(file=sys.stderr)


# ----------------------------------------------------------------------
# Helpers called from instrumented code
# ----------------------------------------------------------------------

def _ft_enter(
    module: str,
    qualname: str,
    locals_dict: dict[str, Any],
    visibility: str,
) -> dict:
    """Called at the start of every instrumented function. Returns a ctx dict."""
    try:
        return _enter(module, qualname, locals_dict, visibility)
    except BaseException:  # noqa: BLE001 — must never reach the traced program
        _internal_failure("_ft_enter")
        return _DEAD_CTX


def _enter(module: str, qualname: str, locals_dict: dict[str, Any], visibility: str) -> dict:
    parent_id: str | None = current_span_id.get() or None
    trace_id = current_trace_id.get() or new_trace_id()
    span_id = new_span_id()
    depth = current_depth.get()

    tokens = enter_span(trace_id, span_id)
    try:
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
    except BaseException:
        # The span never opened as far as the trace is concerned, so the
        # context must not stay entered — every later call in this thread
        # would otherwise hang off a span nobody emitted.
        exit_span(tokens)
        raise

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
    if ctx is _DEAD_CTX or not isinstance(ctx, dict) or "tokens" not in ctx:
        return
    try:
        duration_ns = time.perf_counter_ns() - ctx["start_ns"]
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
            "result": _serialize_result(result),
            "duration_ns": duration_ns,
            "depth": ctx["depth"],
        })
    except BaseException:  # noqa: BLE001
        _internal_failure("_ft_exit")
    finally:
        exit_span(ctx["tokens"])


def _ft_exit_error(ctx: dict, exc: BaseException) -> None:
    """Called when the function raises an exception."""
    if ctx is _DEAD_CTX or not isinstance(ctx, dict) or "tokens" not in ctx:
        return
    try:
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
            # `result` stays {} and the error goes in the top-level `error` field.
            # This used to emit `result: {"error": ...}`, which was schema-VALID
            # (result is a free-form object, so nothing rejected it) but invisible
            # to every consumer: trace.find_error looks for a top-level `error`, so
            # it reported "no errors" on Python traces full of exceptions. Java and
            # Node already used the top-level field; Python was the odd one out.
            "result": {},
            "error": error_info,
            "duration_ns": duration_ns,
            "depth": ctx["depth"],
        })
    except BaseException:  # noqa: BLE001
        _internal_failure("_ft_exit_error")
    finally:
        exit_span(ctx["tokens"])


# Expose as module-level names so loader can inject them by reference.
HELPERS: dict[str, Any] = {
    "_ft_enter": _ft_enter,
    "_ft_exit": _ft_exit,
    "_ft_exit_error": _ft_exit_error,
}
