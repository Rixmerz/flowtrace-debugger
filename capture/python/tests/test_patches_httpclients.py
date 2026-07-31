"""Outbound propagation through each supported HTTP client.

``http.client`` covers urllib and requests, but httpx and aiohttp ship their own
transports and never touch it, so a single stdlib patch silently missed them —
and httpx in particular is the default client in most modern FastAPI codebases.

Each test starts a real one-shot HTTP server and asserts the ``traceparent``
header actually arrived, rather than asserting on the patch's internals. A patch
that is installed but ineffective would pass an introspection test and fail this
one.
"""

from __future__ import annotations

import http.server
import socket
import threading
import urllib.request

import pytest

from flowtrace_runtime.context import current_depth, current_span_id, current_trace_id
from flowtrace_runtime.patches import install as install_patches
from flowtrace_runtime.propagation import TRACEPARENT, seed_context

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN = "00f067aa0ba902b7"
VALID = f"00-{TRACE}-{SPAN}-01"


@pytest.fixture(autouse=True)
def _clean_context():
    tokens = (
        current_trace_id.set(""),
        current_span_id.set(""),
        current_depth.set(0),
    )
    yield
    current_depth.reset(tokens[2])
    current_span_id.reset(tokens[1])
    current_trace_id.reset(tokens[0])


class _CaptureHandler(http.server.BaseHTTPRequestHandler):
    """Records the inbound headers on the server instance, then replies."""

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler API
        self.server.captured_headers = dict(self.headers)
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep pytest output clean
        pass


@pytest.fixture
def server():
    """A one-shot HTTP server; yields (url, get_captured_headers)."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    httpd = http.server.HTTPServer(("127.0.0.1", port), _CaptureHandler)
    httpd.captured_headers = None
    thread = threading.Thread(target=httpd.handle_request, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}/", lambda: httpd.captured_headers
    finally:
        httpd.server_close()
        thread.join(timeout=5)


def _traceparent_of(headers):
    assert headers is not None, "server never received a request"
    for key, value in headers.items():
        if key.lower() == TRACEPARENT:
            return value
    return None


def test_urllib_propagates(server):
    """Covers the http.client patch, and therefore requests/urllib3 too."""
    url, captured = server
    install_patches()
    seed_context(VALID)

    with urllib.request.urlopen(url, timeout=10) as resp:
        resp.read()

    assert _traceparent_of(captured()) == VALID


def test_no_header_is_sent_without_an_active_context(server):
    url, captured = server
    install_patches()
    # No seed_context: there is no trace to continue, so injecting a header
    # would fabricate one.

    with urllib.request.urlopen(url, timeout=10) as resp:
        resp.read()

    assert _traceparent_of(captured()) is None


def test_httpx_sync_propagates(server):
    httpx = pytest.importorskip("httpx")
    url, captured = server
    install_patches()
    seed_context(VALID)

    with httpx.Client() as client:
        client.get(url, timeout=10)

    assert _traceparent_of(captured()) == VALID


def test_httpx_async_propagates(server):
    httpx = pytest.importorskip("httpx")
    import asyncio

    url, captured = server
    install_patches()

    async def go():
        # Seed inside the task: ContextVars are per-context, and the async client
        # must read the context active where the request is made.
        seed_context(VALID)
        async with httpx.AsyncClient() as client:
            await client.get(url, timeout=10)

    asyncio.run(go())

    assert _traceparent_of(captured()) == VALID


def test_aiohttp_propagates(server):
    aiohttp = pytest.importorskip("aiohttp")
    import asyncio

    url, captured = server
    install_patches()

    async def go():
        seed_context(VALID)
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                await resp.read()

    asyncio.run(go())

    assert _traceparent_of(captured()) == VALID


def test_an_explicit_caller_header_is_never_overwritten(server):
    httpx = pytest.importorskip("httpx")
    url, captured = server
    install_patches()
    seed_context(VALID)

    explicit = "00-" + "c" * 32 + f"-{SPAN}-01"
    with httpx.Client() as client:
        client.get(url, headers={TRACEPARENT: explicit}, timeout=10)

    assert _traceparent_of(captured()) == explicit
