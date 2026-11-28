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
import types
from typing import Any

from contextvars import ContextVar

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


def _get_safe_repr() -> bool:
    """FLOWTRACE_SAFE_REPR=1: never call a Python-defined __repr__ (opt-in)."""
    if "safe_repr" not in _config:
        _config["safe_repr"] = os.environ.get("FLOWTRACE_SAFE_REPR", "") in ("1", "true", "yes")
    return _config["safe_repr"]


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
# Re-entrancy guard
# ----------------------------------------------------------------------
#
# Serialising an argument, a result or an error calls into the program:
# ``repr(v)`` runs the user's ``__repr__``, ``str(exc)`` its ``__str__``. When
# that class lives in an instrumented module the call is itself a traced
# function, and without a guard it produced an ``enter`` for a function the
# program never called -- before the ``enter`` of the function being
# serialised, with that function's span as parent. A static index then reads it
# as a real caller -> callee edge.
#
# While ``_in_capture`` is set, ``_ft_enter`` returns the dead context: nothing
# is emitted and the span context is left alone, so everything such a callback
# calls in turn is suppressed too. The user's code still runs and its text still
# lands in the trace; it just does not become a span.
#
# A ContextVar, not a module global or a thread-local: each thread and each
# asyncio task has its own, so one thread serialising does not blind another,
# and a task that awaits inside a callback cannot leak the flag to its siblings.
# The hot path pays one ``ContextVar.get`` per instrumented call; the flag is
# only *set* around calls into user code (non-primitive values, exceptions).

_in_capture: ContextVar[bool] = ContextVar("flowtrace_in_capture", default=False)


def _safe_repr(v: Any) -> str:
    """``repr(v)`` with tracing of whatever it calls switched off."""
    tok = _in_capture.set(True)
    try:
        return repr(v)
    finally:
        _in_capture.reset(tok)


def _render_opaque(v: Any) -> str:
    """Render a non-primitive value. With FLOWTRACE_SAFE_REPR=1 an object whose
    class defines ``__repr__`` in Python is NOT repr()'d (that is user code and
    may have side effects): it is rendered as ``<module.QualName>``, no address."""
    if _get_safe_repr():
        t = type(v)
        if isinstance(getattr(t, "__repr__", None), types.FunctionType):
            return f"<{t.__module__}.{t.__qualname__}>"
    return _safe_repr(v)


def _safe_str(v: Any) -> str:
    tok = _in_capture.set(True)
    try:
        return str(v)
    finally:
        _in_capture.reset(tok)


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
        s = _safe_repr(serialized)
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
            sk = k if type(k) is str else _safe_str(k)
            if redact_keys and _is_redacted_key(sk, redact_keys):
                out[sk] = "<redacted>"
            else:
                out[sk] = _to_json_safe(vv, redact_keys)
        return out
    try:
        return _render_opaque(v)
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
    file: str | None = None,
    line: int | None = None,
) -> dict:
    """Called at the start of every instrumented function. Returns a ctx dict.

    ``file`` / ``line`` are the declaration site, baked in as literals by the
    transformer (POSIX path relative to the project root, 1-indexed ``def``
    line). They are optional — a caller that omits them gets an event without
    them — and they are written as given: never redacted, never truncated.
    """
    if _in_capture.get():
        return _DEAD_CTX
    try:
        return _enter(module, qualname, locals_dict, visibility, file, line)
    except BaseException:  # noqa: BLE001 — must never reach the traced program
        _internal_failure("_ft_enter")
        return _DEAD_CTX


def _enter(
    module: str,
    qualname: str,
    locals_dict: dict[str, Any],
    visibility: str,
    file: str | None = None,
    line: int | None = None,
) -> dict:
    parent_id: str | None = current_span_id.get() or None
    trace_id = current_trace_id.get() or new_trace_id()
    span_id = new_span_id()
    depth = current_depth.get()

    tokens = enter_span(trace_id, span_id)
    try:
        class_name, method_name = _extract_class_method(qualname)
        args = _serialize_args(locals_dict)

        event = {
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
        }
        # Enter only, and both or neither: a line with no file names nothing.
        if file is not None and line is not None:
            event["file"] = file
            event["line"] = line
        Emitter.instance().emit(event)
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
        if not ctx.get("paused"):
            exit_span(ctx["tokens"])


def _ft_exit_error(ctx: dict, exc: BaseException) -> None:
    """Called when the function raises an exception."""
    if ctx is _DEAD_CTX or not isinstance(ctx, dict) or "tokens" not in ctx:
        return
    try:
        duration_ns = time.perf_counter_ns() - ctx["start_ns"]

        # str(exc) and format_exception run the exception's own __str__ /
        # __repr__ (and those of its notes and chained causes).
        tok = _in_capture.set(True)
        try:
            tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
            msg = str(exc)
        finally:
            _in_capture.reset(tok)
        error_info = {
            "type": type(exc).__name__,
            "msg": msg,
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
        if not ctx.get("paused"):
            exit_span(ctx["tokens"])


# ----------------------------------------------------------------------
# Generator frames
# ----------------------------------------------------------------------
#
# A generator function's span covers creation-to-exhaustion for *duration*
# (enter at the first ``next()``, exit when the body finishes, is closed, or
# raises), but it is the *current parent* only while its own frame executes.
# At a ``yield`` the frame is suspended and control returns to the consumer, so
# ``_ft_pause`` restores the span context the consumer had; ``_ft_resume``
# re-enters the generator's span when the consumer resumes it. Without this the
# generator's span stayed current after the first ``yield``: the body of a
# ``with`` over a ``@contextmanager``, and every call made between two
# ``next()`` calls, was recorded as a child of the generator.
#
# The transformer inserts these around every ``yield`` / ``yield from`` of the
# function's own body. ``resume`` is idempotent so it can also run from a
# ``finally`` (a ``throw()`` or ``close()`` at the yield skips the expression
# form). Both are no-ops for the dead context and never raise.

def _ft_pause(ctx: Any, value: Any = None) -> Any:
    """Called just before a yield hands control to the consumer. Returns ``value``."""
    try:
        if ctx is not _DEAD_CTX and isinstance(ctx, dict) and not ctx.get("paused"):
            tokens = ctx.get("tokens")
            if tokens is not None:
                ctx["paused"] = True
                exit_span(tokens)
    except BaseException:  # noqa: BLE001
        _internal_failure("_ft_pause")
    return value


def _ft_resume(ctx: Any, sent: Any = None) -> Any:
    """Called when the consumer resumes the generator. Returns ``sent``."""
    try:
        if ctx is not _DEAD_CTX and isinstance(ctx, dict) and ctx.get("paused"):
            ctx["paused"] = False
            ctx["tokens"] = _reenter(ctx["trace_id"], ctx["span_id"], ctx["depth"])
    except BaseException:  # noqa: BLE001
        _internal_failure("_ft_resume")
    return sent


def _reenter(trace_id: str, span_id: str, depth: int) -> Any:
    # Same as enter_span, but the depth is the span's own, not the consumer's.
    tok_trace = current_trace_id.set(trace_id)
    tok_span = current_span_id.set(span_id)
    tok_depth = current_depth.set(depth + 1)
    return tok_trace, tok_span, tok_depth


# Expose as module-level names so loader can inject them by reference.
HELPERS: dict[str, Any] = {
    "_ft_enter": _ft_enter,
    "_ft_exit": _ft_exit,
    "_ft_exit_error": _ft_exit_error,
    "_ft_pause": _ft_pause,
    "_ft_resume": _ft_resume,
}
