"""Shared utilities for AgentCockpit hooks."""
import re
from pathlib import Path

_DOMAIN_MAP = {
    "auth": ["auth", "login", "session", "token", "jwt"],
    "api": ["api", "endpoint", "route", "controller", "handler", "middleware"],
    "ui": ["component", "page", "view", "layout", "modal", "form", "panel"],
    "config": ["config", "setting", "env", "constant"],
    "data": ["model", "schema", "entity", "migration", "repository", "store"],
    "style": ["style", "css", "theme"],
    "util": ["util", "helper", "lib", "common", "shared"],
}


def extract_keywords(path: str) -> list[str]:
    """Extract keywords from a file path."""
    stem = Path(path).stem.lower()
    words = re.split(r'(?<=[a-z])(?=[A-Z])|[-_./\\]', stem)
    words = [w.lower() for w in words if len(w) > 1]
    parent = Path(path).parent.name.lower()
    if parent and len(parent) > 1 and parent not in (".", "src"):
        words.append(parent)
    return list(dict.fromkeys(words))  # dedupe preserving order


def guess_domain(path: str) -> str:
    """Guess domain from file path."""
    lower = path.lower()
    best, best_score = "", 0
    for domain, kws in _DOMAIN_MAP.items():
        score = sum(1 for kw in kws if kw in lower)
        if score > best_score:
            best_score = score
            best = domain
    return best or "general"
