"""Cross-boundary propagation integration tests.

These are the tests that actually prove the feature: a trace_id must survive a
process boundary (env carrier) and a network boundary (HTTP header), so that two
separately-traced programs produce ONE tree rather than two.

Real subprocesses are spawned with the real sitecustomize stub — nothing is
stubbed out.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[3]
GOLDEN_PY = REPO_ROOT / "examples" / "golden" / "python" / "calculator.py"
STUB_DIR = REPO_ROOT / "capture" / "python" / "stub"
CAPTURE_PKG = REPO_ROOT / "capture" / "python"

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN = "00f067aa0ba902b7"
VALID = f"00-{TRACE}-{SPAN}-01"


def _base_env(out_path: str, prefix: str, **extra: str) -> dict[str, str]:
    pythonpath_parts = [str(STUB_DIR), str(CAPTURE_PKG)]
    existing = os.environ.get("PYTHONPATH", "")
    if existing:
        pythonpath_parts.append(existing)

    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(pythonpath_parts),
        "FLOWTRACE_ENABLE": "1",
        "FLOWTRACE_PACKAGE_PREFIX": prefix,
        "FLOWTRACE_OUTPUT": out_path,
    }
    # A stale carrier in the developer's own shell would silently poison every
    # assertion here, so start from a known-clean slate.
    env.pop("FLOWTRACE_TRACEPARENT", None)
    env.update(extra)
    return env


def _read_events(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8").strip()
    assert text, f"no trace output written to {path}"
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _tmp_jsonl() -> str:
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as tmp:
        return tmp.name


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


pytestmark = pytest.mark.skipif(
    not GOLDEN_PY.exists(), reason="golden calculator.py not found"
)


def test_env_carrier_seeded_child_continues_parent_trace():
    out_path = _tmp_jsonl()
    try:
        result = subprocess.run(
            [sys.executable, str(GOLDEN_PY)],
            env=_base_env(out_path, "calculator", FLOWTRACE_TRACEPARENT=VALID),
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"

        events = _read_events(out_path)

        # Every span must belong to the seeded trace, not a freshly minted one.
        assert {e["trace_id"] for e in events} == {TRACE}

        # The local root must hang off the remote span, and must still be
        # depth 0 (the synthetic parent's depth of -1 exists for exactly this).
        roots = [e for e in events if e["depth"] == 0 and e["event"] == "enter"]
        assert roots, "expected at least one depth-0 enter event"
        for root in roots:
            assert root["parent_id"] == SPAN

        # No event may violate the schema's depth >= 0 constraint.
        for event in events:
            assert event["depth"] >= 0
    finally:
        Path(out_path).unlink(missing_ok=True)


def test_env_carrier_unseeded_child_mints_its_own_trace():
    out_path = _tmp_jsonl()
    try:
        subprocess.run(
            [sys.executable, str(GOLDEN_PY)],
            env=_base_env(out_path, "calculator"),  # no carrier
            capture_output=True,
            text=True,
            timeout=30,
        )
        events = _read_events(out_path)
        # Regression guard: seeding must not leak in when the carrier is absent.
        assert events[0]["trace_id"] != TRACE
        for root in (e for e in events if e["depth"] == 0 and e["event"] == "enter"):
            assert root["parent_id"] is None
    finally:
        Path(out_path).unlink(missing_ok=True)


def test_env_carrier_malformed_value_is_ignored():
    out_path = _tmp_jsonl()
    try:
        result = subprocess.run(
            [sys.executable, str(GOLDEN_PY)],
            env=_base_env(out_path, "calculator", FLOWTRACE_TRACEPARENT="total-garbage"),
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"a bad carrier must not break the app: {result.stderr}"

        # Must still produce a valid, self-consistent trace.
        events = _read_events(out_path)
        assert re.fullmatch(r"[0-9a-f]{32}", events[0]["trace_id"])
        for event in events:
            assert event["depth"] >= 0
    finally:
        Path(out_path).unlink(missing_ok=True)


# ── HTTP carrier ─────────────────────────────────────────────────────

SERVER_SRC = '''
"""Instrumented one-shot HTTP server fixture."""

from http.server import BaseHTTPRequestHandler, HTTPServer

from flowtrace_runtime import continue_trace, extract


def build_greeting(name):
    return "hello " + name


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # continue_trace is the documented integration point: frameworks each
        # expose inbound headers differently, so extraction is explicit.
        with continue_trace(extract(dict(self.headers))):
            body = handle_request()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass  # keep stderr clean


def handle_request():
    return build_greeting("world")


server = HTTPServer(("127.0.0.1", PORT), Handler)
print("READY", flush=True)
server.handle_request()   # one-shot
'''

CLIENT_SRC = '''
"""Instrumented HTTP client fixture — the request is made from inside a span."""

import urllib.request


def fetch_greeting(port):
    # urllib goes through http.client.HTTPConnection.request, which the
    # propagation patch wraps, so the header is injected automatically.
    with urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=10) as resp:
        return resp.read().decode()


print("GOT", fetch_greeting(PORT), flush=True)
'''


def test_http_carrier_client_and_server_land_in_one_trace(tmp_path):
    port = _free_port()

    server_py = tmp_path / "ft_server.py"
    client_py = tmp_path / "ft_client.py"
    server_py.write_text(f"PORT = {port}\n" + textwrap.dedent(SERVER_SRC), encoding="utf-8")
    client_py.write_text(f"PORT = {port}\n" + textwrap.dedent(CLIENT_SRC), encoding="utf-8")

    server_out = str(tmp_path / "server.jsonl")
    client_out = str(tmp_path / "client.jsonl")

    server = subprocess.Popen(
        [sys.executable, str(server_py)],
        env=_base_env(server_out, "ft_server"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(tmp_path),
    )
    try:
        # Wait for the server to bind before the client fires.
        deadline = time.time() + 30
        ready = False
        while time.time() < deadline:
            line = server.stdout.readline()
            if not line:
                break
            if line.startswith("READY"):
                ready = True
                break
        if not ready:
            server.kill()
            pytest.fail(f"server never reported READY. stderr: {server.stderr.read()}")

        client = subprocess.run(
            [sys.executable, str(client_py)],
            env=_base_env(client_out, "ft_client"),
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(tmp_path),
        )
        assert "GOT hello world" in client.stdout, (
            f"client did not get a response. stderr: {client.stderr}"
        )

        # The server is one-shot; wait for a clean exit so its atexit flush has
        # completed before we read the log.
        server.wait(timeout=30)

        client_events = _read_events(client_out)
        server_events = _read_events(server_out)

        # The span that made the call, and the spans that served it, must share
        # one trace. (Other roots may exist — module-level code runs outside
        # any span and legitimately starts its own trace.)
        call_span = next(
            e for e in client_events
            if e["event"] == "enter" and e["method"] == "fetch_greeting"
        )

        served = [e for e in server_events if e["trace_id"] == call_span["trace_id"]]
        assert served, "server emitted nothing in the client trace — header did not propagate"

        # The server's root span must be parented to the exact client span that
        # issued the request. This is the link that makes the tree connect.
        server_root = next(
            (e for e in served if e["event"] == "enter" and e["parent_id"] == call_span["span_id"]),
            None,
        )
        assert server_root is not None, (
            f"no server span is parented to the calling span {call_span['span_id']}"
        )
        assert server_root["depth"] == 0

        # ...and the handler's own work must nest under that root.
        greeting = next(
            (e for e in served if e["event"] == "enter" and e["method"] == "build_greeting"),
            None,
        )
        assert greeting is not None, "expected build_greeting to be traced in the joined trace"
        assert greeting["depth"] >= 1

        for event in client_events + server_events:
            assert event["depth"] >= 0
    finally:
        if server.poll() is None:
            server.kill()
