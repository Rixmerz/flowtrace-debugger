"""JSONL v2 emitter — singleton, thread-safe, fork-safe, zero runtime dependencies.

Output path resolution (first match wins):
  1. FLOWTRACE_OUTPUT env var
  2. .flowtrace/<timestamp>.<ms>-<pid>.jsonl  (created relative to cwd at first emit)

The emitter never raises into the traced program. A write that fails — an
unwritable path, a full disk, FLOWTRACE_OUTPUT pointing at a directory — is
reported once on stderr and counted; the count is printed at exit so the hole
in the trace is visible.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import ClassVar, Optional

# W3C ID validation patterns (compile once).
_TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SPAN_ID_RE = re.compile(r"^[0-9a-f]{16}$")
_PARENT_ID_RE = re.compile(r"^[0-9a-f]{16}$")

# Required fields per event type.
_ENTER_REQUIRED = frozenset({
    "ts", "trace_id", "span_id", "parent_id", "event",
    "thread", "lang", "module", "class", "method",
    "visibility", "args", "depth",
})
_EXIT_REQUIRED = frozenset({
    "ts", "trace_id", "span_id", "parent_id", "event",
    "thread", "lang", "module", "class", "method",
    "visibility", "args", "result", "duration_ns", "depth",
})


def _default_output_path() -> Path:
    # Millisecond + pid suffix: two processes started in the same second used
    # to append to one file (the Go layer had the same defect).
    now = time.time()
    ts = time.strftime("%Y%m%dT%H%M%S", time.localtime(now))
    ms = int((now - int(now)) * 1000)
    out_dir = Path(".flowtrace")
    out_dir.mkdir(exist_ok=True)
    return out_dir / f"{ts}.{ms:03d}-{os.getpid()}.jsonl"


class Emitter:
    """Singleton JSONL writer for FlowTrace v2 events."""

    _instance: ClassVar[Optional["Emitter"]] = None
    _instance_lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._file = None
        self._path: Optional[Path] = None
        self._dropped = 0
        self._warned: set[str] = set()
        atexit.register(self._at_exit)
        # A forked child inherits a lock that may be held by another thread of
        # the parent (deadlock on first emit) and the parent's open descriptor
        # (both processes appending to one file through one buffer). Start the
        # child with a fresh lock and no file; _ensure_open reopens in append
        # mode, so the child lands in the same file without sharing state.
        if hasattr(os, "register_at_fork"):
            os.register_at_fork(after_in_child=self._after_fork_in_child)

    # ------------------------------------------------------------------
    # Singleton access
    # ------------------------------------------------------------------

    @classmethod
    def instance(cls) -> "Emitter":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def emit(self, event: dict) -> None:
        """Validate and append one v2 event as a JSON line.

        Drops malformed and unwritable events with a warning to stderr — never
        raises.
        """
        error = self._validate(event)
        if error:
            self._drop("malformed", f"dropping malformed event — {error}")
            return
        try:
            line = json.dumps(event, separators=(",", ":"))
        except Exception as e:  # a value _to_json_safe did not catch
            self._drop("serialize", f"dropping event that cannot be serialized — {e}")
            return
        try:
            with self._lock:
                self._ensure_open()
                self._file.write(line + "\n")
                self._file.flush()
        except Exception as e:
            self._drop("write", f"failed to write event ({e}); the trace has holes")

    def path(self) -> Optional[Path]:
        """Return the output file path (None until first emit)."""
        return self._path

    def dropped_count(self) -> int:
        """Events that were not written: malformed, unserializable, or write failure."""
        return self._dropped

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _drop(self, cause: str, message: str) -> None:
        self._dropped += 1
        if cause in self._warned:
            return
        self._warned.add(cause)
        print(
            f"[flowtrace] WARNING: {message} (further occurrences are counted, not printed)",
            file=sys.stderr,
        )

    def _ensure_open(self) -> None:
        """Open the output file lazily (called under self._lock)."""
        if self._file is not None:
            return
        env_path = os.environ.get("FLOWTRACE_OUTPUT")
        self._path = Path(env_path) if env_path else _default_output_path()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self._path, "a", encoding="utf-8")  # noqa: SIM115

    def _after_fork_in_child(self) -> None:
        self._lock = threading.Lock()
        self._file = None
        self._warned = set()
        self._dropped = 0

    def _flush(self) -> None:
        with self._lock:
            if self._file is not None:
                try:
                    self._file.flush()
                except Exception:
                    pass

    def _at_exit(self) -> None:
        self._flush()
        if self._dropped:
            print(
                f"[flowtrace] {self._dropped} event(s) were dropped; the trace has holes",
                file=sys.stderr,
            )

    def _validate(self, event: dict) -> str:
        """Return an error message string, or empty string if valid."""
        event_type = event.get("event")
        if event_type == "enter":
            required = _ENTER_REQUIRED
        elif event_type == "exit":
            required = _EXIT_REQUIRED
        else:
            return f"unknown event type: {event_type!r}"

        missing = required - event.keys()
        if missing:
            return f"missing required fields: {sorted(missing)}"

        # W3C ID validation.
        if not _TRACE_ID_RE.match(str(event.get("trace_id", ""))):
            return f"invalid trace_id: {event.get('trace_id')!r}"
        if not _SPAN_ID_RE.match(str(event.get("span_id", ""))):
            return f"invalid span_id: {event.get('span_id')!r}"
        parent_id = event.get("parent_id")
        if parent_id is not None and not _PARENT_ID_RE.match(str(parent_id)):
            return f"invalid parent_id: {parent_id!r}"

        return ""
