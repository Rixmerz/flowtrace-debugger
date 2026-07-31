"""Stdlib monkeypatches that carry trace context across boundaries.

Two patch points, chosen because they are the narrowest chokepoints that cover
the widest surface without adding a dependency (``flowtrace-runtime`` has zero
runtime deps by design):

- ``http.client.HTTPConnection.request`` — every stdlib-based HTTP client
  funnels through it, so ``urllib``, ``urllib3`` and therefore ``requests`` are
  all covered by one patch.

- ``httpx.Client.send`` / ``httpx.AsyncClient.send`` and
  ``aiohttp.ClientSession._request`` — these libraries ship their own transports
  and never touch ``http.client``, so the patch above misses them entirely.
  They are patched only when importable; see ``_OPTIONAL_PATCHES``.

- ``subprocess.Popen.__init__`` — ``run``, ``call``, ``check_output`` and
  friends all construct a Popen, so one patch covers the whole module. This is
  what makes the env carrier useful: without it ``FLOWTRACE_TRACEPARENT`` would
  only ever be set by hand.

Both patches are idempotent and fail open — a propagation bug must never break
the traced application.
"""

from __future__ import annotations

import os

from .propagation import TRACEPARENT_ENV, current_traceparent, inject

_installed = False

# Index of `env` in Popen.__init__'s positional parameters, counting from the
# first argument after `args`. Callers essentially never pass it positionally,
# but honouring it costs one branch and avoids silently dropping their value.
_POPEN_ENV_POS = 9


def _patch_http_client() -> None:
    import http.client

    original = http.client.HTTPConnection.request
    if getattr(original, "_flowtrace_patched", False):
        return

    def request(self, method, url, body=None, headers=None, **kwargs):  # type: ignore[no-untyped-def]
        try:
            merged = dict(headers) if headers else {}
            inject(merged)
        except Exception:
            merged = headers if headers is not None else {}
        return original(self, method, url, body, merged, **kwargs)

    request._flowtrace_patched = True  # type: ignore[attr-defined]
    http.client.HTTPConnection.request = request  # type: ignore[method-assign]


def _patch_subprocess() -> None:
    import subprocess

    original = subprocess.Popen.__init__
    if getattr(original, "_flowtrace_patched", False):
        return

    def __init__(self, args, *a, **kw):  # type: ignore[no-untyped-def]
        try:
            traceparent = current_traceparent()
            if traceparent:
                if len(a) > _POPEN_ENV_POS:
                    # env was passed positionally — rewrite that slot.
                    positional = list(a)
                    base = positional[_POPEN_ENV_POS]
                    merged = dict(base) if base is not None else dict(os.environ)
                    merged[TRACEPARENT_ENV] = traceparent
                    positional[_POPEN_ENV_POS] = merged
                    a = tuple(positional)
                else:
                    base = kw.get("env")
                    # env=None means "inherit os.environ"; preserve that.
                    merged = dict(base) if base is not None else dict(os.environ)
                    merged[TRACEPARENT_ENV] = traceparent
                    kw["env"] = merged
        except Exception:
            pass  # Fail open — never block the caller from spawning.
        return original(self, args, *a, **kw)

    __init__._flowtrace_patched = True  # type: ignore[attr-defined]
    subprocess.Popen.__init__ = __init__  # type: ignore[method-assign]


def _patch_httpx() -> None:
    """Patch httpx, which has its own transport and bypasses http.client entirely.

    ``Client.send`` / ``AsyncClient.send`` are the chokepoint: every convenience
    method (``get``, ``post``, ``request``, ``stream``) builds a ``Request`` and
    funnels through ``send``, and ``request.headers`` is still mutable there.
    Patching the transport instead would miss nothing but is harder to reach.
    """
    import httpx  # noqa: PLC0415 — deferred on purpose; see install()

    for cls_name in ("Client", "AsyncClient"):
        cls = getattr(httpx, cls_name, None)
        if cls is None:
            continue
        original = cls.send
        if getattr(original, "_flowtrace_patched", False):
            continue

        def make(original):  # bind per-class, not per-loop-variable
            def send(self, request, **kwargs):  # type: ignore[no-untyped-def]
                try:
                    inject(request.headers)
                except Exception:
                    pass
                return original(self, request, **kwargs)

            send._flowtrace_patched = True  # type: ignore[attr-defined]
            return send

        cls.send = make(original)  # type: ignore[method-assign]


def _patch_aiohttp() -> None:
    """Patch aiohttp, which also has its own transport.

    ``ClientSession._request`` is the single point every public method reaches.
    Its ``headers`` keyword may be absent, ``None``, a plain dict or a
    ``CIMultiDict``; it is normalized into a plain dict so :func:`inject` can do
    its case-insensitive check, and aiohttp re-normalizes it downstream.
    """
    import aiohttp  # noqa: PLC0415 — deferred on purpose; see install()

    session = aiohttp.ClientSession
    original = session._request
    if getattr(original, "_flowtrace_patched", False):
        return

    def _request(self, method, str_or_url, **kwargs):  # type: ignore[no-untyped-def]
        try:
            headers = kwargs.get("headers")
            merged = dict(headers) if headers else {}
            inject(merged)
            if merged:
                kwargs["headers"] = merged
        except Exception:
            pass
        return original(self, method, str_or_url, **kwargs)

    _request._flowtrace_patched = True  # type: ignore[attr-defined]
    session._request = _request  # type: ignore[method-assign]


#: Patches that require importing a third-party library. Kept separate because
#: flowtrace-runtime has zero runtime dependencies: importing httpx or aiohttp
#: drags in httpcore/anyio/ssl or the whole aiohttp stack, which must not happen
#: in a process that does not already use them.
#:
#: Python has no post-import hook (PEP 369 was withdrawn), so there is no way to
#: patch these lazily *and* reliably — a library imported after install() would
#: never be patched. OpenTelemetry's Python auto-instrumentation resolves this
#: the same way: import eagerly and accept the cost. Set
#: FLOWTRACE_NO_HTTP_PATCH=1 to skip them if that cost or a version conflict
#: matters more than propagation through those clients.
_OPTIONAL_PATCHES = (_patch_httpx, _patch_aiohttp)


def install() -> None:
    """Install outbound HTTP + subprocess trace-context propagation.

    Idempotent. Individual patches are attempted independently so a failure or a
    missing library in one does not prevent the others.
    """
    global _installed
    if _installed:
        return
    _installed = True

    for patch in (_patch_http_client, _patch_subprocess):
        try:
            patch()
        except Exception:
            pass

    if os.environ.get("FLOWTRACE_NO_HTTP_PATCH") == "1":
        return

    for patch in _OPTIONAL_PATCHES:
        try:
            patch()
        except ImportError:
            pass  # library not installed — nothing to propagate through
        except Exception:
            pass
