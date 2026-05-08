"""JSONL v2 emitter — singleton, thread-safe, zero runtime dependencies.

Output path resolution (first match wins):
  1. FLOWTRACE_OUTPUT env var
  2. .flowtrace/<ISO-timestamp>.jsonl  (created relative to cwd at first emit)
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
    ts = time.strftime("%Y%m%dT%H%M%S")
    out_dir = Path(".flowtrace")
    out_dir.mkdir(exist_ok=True)
    return out_dir / f"{ts}.jsonl"


class Emitter:
    """Singleton JSONL writer for FlowTrace v2 events."""

    _instance: ClassVar[Optional["Emitter"]] = None
    _instance_lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._file = None
        self._path: Optional[Path] = None
        atexit.register(self._flush)

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

        Drops malformed events with a warning to stderr — never raises.
        """
        error = self._validate(event)
        if error:
            print(f"[flowtrace] WARNING: dropping malformed event — {error}", file=sys.stderr)
            return
        line = json.dumps(event, separators=(",", ":"))
        with self._lock:
            self._ensure_open()
            self._file.write(line + "\n")
            self._file.flush()

    def path(self) -> Optional[Path]:
        """Return the output file path (None until first emit)."""
        return self._path

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_open(self) -> None:
        """Open the output file lazily (called under self._lock)."""
        if self._file is not None:
            return
        env_path = os.environ.get("FLOWTRACE_OUTPUT")
        self._path = Path(env_path) if env_path else _default_output_path()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self._path, "a", encoding="utf-8")  # noqa: SIM115

    def _flush(self) -> None:
        with self._lock:
            if self._file is not None:
                try:
                    self._file.flush()
                except Exception:
                    pass

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
