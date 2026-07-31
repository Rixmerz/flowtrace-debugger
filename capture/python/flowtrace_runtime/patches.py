"""Stdlib monkeypatches that carry trace context across boundaries.

Two patch points, chosen because they are the narrowest chokepoints that cover
the widest surface without adding a dependency (``flowtrace-runtime`` has zero
runtime deps by design):

- ``http.client.HTTPConnection.request`` — every stdlib-based HTTP client
  funnels through it, so ``urllib``, ``urllib3`` and therefore ``requests`` are
  all covered by one patch. Clients with their own transport stack (``httpx``,
  ``aiohttp``) are NOT covered; use
  :func:`flowtrace_runtime.propagation.inject` on their headers directly.

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


def install() -> None:
    """Install outbound HTTP + subprocess trace-context propagation.

    Idempotent. Individual patches are attempted independently so that a
    failure in one does not prevent the other.
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
