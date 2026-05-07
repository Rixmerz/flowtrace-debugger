#!/usr/bin/env python3
"""User Memory Injector — UserPromptSubmit hook.

Two-tier memory architecture:
  ~/.jig/memory/          = user-level brain (global, cross-project)
  $PROJECT/.claude/memory/ = project cache (local copies of recalled memories)

On each prompt:
  1. Score user memories by keyword relevance to the prompt
  2. Check which relevant memories are NOT yet in the project cache
  3. Inject only the uncached ones (avoids token duplication)
  4. Copy injected memories into .claude/memory/ so future prompts skip them

Result: a memory is injected exactly once per project, then lives locally.
The existing memory_injector.py (PreToolUse) reads .claude/memory/ on edits.

Protocol:
  stdin:  {"session_id": "...", "transcript_path": "...", "hook_event_name": "UserPromptSubmit", "prompt": "..."}
  stdout: injected context block (shown to Claude as additional context)
  exit 0: always
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import struct
import sys
import time
from pathlib import Path

TOKEN_BUDGET = 4000  # chars (~1000 tokens)
MIN_KEYWORD_OVERLAP = 0.08  # minimum keyword-only overlap to include a node
MIN_SEMANTIC_SCORE: float = 0.45  # cosine similarity threshold
MEMORY_DIR = Path.home() / ".jig" / "memory"

_embedder_instance: object | None = None
_embedder_checked: bool = False


def _init_embedder() -> bool:
    """Lazily load jig.core.embeddings embedder. Returns True if available."""
    global _embedder_instance, _embedder_checked
    if _embedder_checked:
        return _embedder_instance is not None
    _embedder_checked = True
    try:
        from jig.core.embeddings import get_embedder  # type: ignore[import]
        client = get_embedder()
        if client.available:
            _embedder_instance = client
            return True
    except Exception:
        pass
    return False


def _cosine(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity — no numpy required."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _build_memory_text(node: dict) -> str:
    """Build searchable text for embedding: name + description + tags."""
    tags = node.get("tags", [])
    tags_str = " ".join(tags) if isinstance(tags, list) else str(tags)
    return f"{node.get('name', '')} {node.get('description', '')} {tags_str}"


_EMBED_CACHE_PATH = Path.home() / ".jig" / "memory_embeddings.db"


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _load_embed_cache() -> dict[str, tuple[str, list[float]]]:
    """Load {node_id: (text_hash, vector)} from cache. Returns {} on any error."""
    try:
        conn = sqlite3.connect(str(_EMBED_CACHE_PATH), timeout=2)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS embeddings "
            "(node_id TEXT PRIMARY KEY, text_hash TEXT NOT NULL, "
            "vector BLOB NOT NULL, updated_at REAL NOT NULL)"
        )
        rows = conn.execute("SELECT node_id, text_hash, vector FROM embeddings").fetchall()
        conn.close()
        result: dict[str, tuple[str, list[float]]] = {}
        for node_id, th, blob in rows:
            n = len(blob) // 4
            vec = list(struct.unpack(f"{n}f", blob))
            result[node_id] = (th, vec)
        return result
    except Exception:
        return {}


def _save_embed_cache(updates: dict[str, tuple[str, list[float]]]) -> None:
    """Persist new/updated embeddings to cache. Silent on error."""
    if not updates:
        return
    try:
        conn = sqlite3.connect(str(_EMBED_CACHE_PATH), timeout=2)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS embeddings "
            "(node_id TEXT PRIMARY KEY, text_hash TEXT NOT NULL, "
            "vector BLOB NOT NULL, updated_at REAL NOT NULL)"
        )
        now = time.time()
        for node_id, (th, vec) in updates.items():
            blob = struct.pack(f"{len(vec)}f", *vec)
            conn.execute(
                "INSERT OR REPLACE INTO embeddings (node_id, text_hash, vector, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (node_id, th, blob, now),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass

_STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "its", "be", "as", "are",
    "was", "were", "has", "have", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "this", "that",
    "these", "those", "i", "we", "you", "he", "she", "they", "me", "us",
    "him", "her", "them", "my", "our", "your", "his", "their", "what",
    "how", "why", "when", "where", "which", "who", "not", "no", "so",
    "if", "then", "than", "also", "just", "more", "some", "any", "all",
    "there", "here", "now", "up", "out", "about", "into", "over", "after",
    "el", "la", "los", "las", "un", "una", "de", "del", "en", "es", "se",
    "que", "por", "para", "con", "una", "su", "al", "lo", "si", "pero",
    "como", "ya", "o", "y", "e", "u", "no", "hay", "le", "les", "te",
})


def _keywords(text: str) -> set[str]:
    words = re.findall(r"[a-záéíóúñüA-ZÁÉÍÓÚÑÜ_][a-záéíóúñüA-ZÁÉÍÓÚÑÜ0-9_]*", text.lower())
    return {w for w in words if len(w) > 2 and w not in _STOP_WORDS}


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("---", 3)
    if end == -1:
        return {}, text
    fm: dict = {}
    current_list_key: str | None = None
    for line in text[3:end].splitlines():
        if line.startswith("  - ") or line.startswith("- "):
            val = line.strip().lstrip("- ")
            if current_list_key:
                if not isinstance(fm.get(current_list_key), list):
                    fm[current_list_key] = []
                fm[current_list_key].append(val)
        elif ":" in line and not line.startswith(" "):
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            fm[key] = val if val else None
            current_list_key = key if not val else None
        else:
            current_list_key = None
    body = text[end + 3:].lstrip("\n")
    return fm, body


def _parse_ttl(ttl_str: str) -> float | None:
    m = re.match(r"^(\d+)([dhw])$", ttl_str.strip())
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    return n * {"d": 86400, "h": 3600, "w": 604800}[unit]


def _load_memories() -> list[dict]:
    if not MEMORY_DIR.exists():
        return []
    nodes = []
    for f in MEMORY_DIR.glob("*.md"):
        try:
            fm, body = _parse_frontmatter(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        ttl_str = fm.get("ttl", "")
        if ttl_str:
            ttl_secs = _parse_ttl(ttl_str)
            if ttl_secs is not None and (time.time() - f.stat().st_mtime) > ttl_secs:
                continue
        nodes.append({
            "id": fm.get("id") or f.stem,
            "name": fm.get("name", f.stem),
            "description": fm.get("description", ""),
            "type": fm.get("type", "reference"),
            "tags": fm.get("tags") or [],
            "priority": fm.get("priority", "normal"),
            "mtime": f.stat().st_mtime,
            "body": body,
        })
    return nodes


def _keyword_overlap(node: dict, prompt_kw: set[str]) -> float:
    """Pure keyword overlap score — used for threshold gating."""
    if not prompt_kw:
        return 0.0
    tag_kw = _keywords(" ".join(node["tags"]))
    name_kw = _keywords(node["name"])
    desc_kw = _keywords(node["description"])
    body_kw = _keywords(node["body"][:800])
    tag_s = len(prompt_kw & tag_kw) / (len(tag_kw) + 1) * 1.5
    name_s = len(prompt_kw & name_kw) / (len(name_kw) + 1) * 1.2
    desc_s = len(prompt_kw & desc_kw) / (len(desc_kw) + 1) * 0.8
    body_s = len(prompt_kw & body_kw) / (len(body_kw) + 1) * 0.4
    return tag_s + name_s + desc_s + body_s


def _relevance(node: dict, prompt_kw: set[str]) -> float:
    """Full ranking score — used for ordering, after threshold gate passes."""
    base = _keyword_overlap(node, prompt_kw)
    type_boost = {"feedback": 0.15, "user": 0.10, "project": 0.05, "reference": 0.0}.get(node["type"], 0.0)
    recency = 1.0 / (1.0 + (time.time() - node["mtime"]) / 86400) * 0.05
    return base + type_boost + recency


def _format(node: dict) -> str:
    parts = [f"[{node['type']}] {node['name']}"]
    if node["description"]:
        parts.append(node["description"])
    if node["body"].strip():
        parts.append(node["body"].strip())
    return "\n".join(parts)


def _project_memory_dir() -> Path | None:
    """Return .claude/memory/ for the current project, or None if not in a project."""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        return None
    p = Path(project_dir) / ".claude" / "memory"
    return p


def _is_cached(node_id: str, memory_dir: Path) -> bool:
    """True if project cache copy exists AND is not older than the global source."""
    local = memory_dir / f"{node_id}.md"
    if not local.exists():
        return False
    global_src = MEMORY_DIR / f"{node_id}.md"
    if not global_src.exists():
        return True  # global deleted — keep local as-is, gc will handle it
    return local.stat().st_mtime >= global_src.stat().st_mtime


def _cache_memory(node: dict, raw_text: str, memory_dir: Path) -> None:
    """Copy a user memory into the project cache."""
    try:
        memory_dir.mkdir(parents=True, exist_ok=True)
        (memory_dir / f"{node['id']}.md").write_text(raw_text, encoding="utf-8")
    except Exception:
        pass


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    prompt = payload.get("prompt", "")
    prompt_kw = _keywords(prompt)
    project_mem_dir = _project_memory_dir()

    nodes = _load_memories()
    if not nodes:
        sys.exit(0)

    high = [n for n in nodes if n["priority"] == "high"]
    rest = [n for n in nodes if n["priority"] != "high"]

    # Gate on keyword overlap or semantic similarity for non-high nodes
    use_semantic = os.environ.get("JIG_MEMORY_SEMANTIC", "") == "1"
    if use_semantic and prompt and _init_embedder():
        try:
            prompt_vec: list[float] = _embedder_instance.embed_one(prompt)  # type: ignore[union-attr]

            # Load cache and partition rest into cached vs needs-embedding
            embed_cache = _load_embed_cache()
            to_embed_nodes: list[dict] = []
            to_embed_texts: list[str] = []
            cached_vecs: dict[str, list[float]] = {}

            for n in rest:
                text = _build_memory_text(n)
                th = _text_hash(text)
                cached = embed_cache.get(n["id"])
                if cached and cached[0] == th:
                    cached_vecs[n["id"]] = cached[1]
                else:
                    to_embed_nodes.append(n)
                    to_embed_texts.append(text)

            # Only embed what's not cached
            new_vecs: dict[str, list[float]] = {}
            if to_embed_texts:
                vecs_list = list(_embedder_instance.embed_many(to_embed_texts))  # type: ignore[union-attr]
                for i, n in enumerate(to_embed_nodes):
                    new_vecs[n["id"]] = vecs_list[i]

            # Save new embeddings to cache
            cache_updates = {
                n["id"]: (_text_hash(_build_memory_text(n)), new_vecs[n["id"]])
                for n in to_embed_nodes
                if n["id"] in new_vecs
            }
            _save_embed_cache(cache_updates)

            # Merge cached + new
            memory_vecs = {**cached_vecs, **new_vecs}

            relevant = [
                n for n in rest
                if _cosine(prompt_vec, memory_vecs.get(n["id"], [])) >= MIN_SEMANTIC_SCORE
            ]
            relevant.sort(
                key=lambda n: _cosine(prompt_vec, memory_vecs.get(n["id"], [])) + (
                    {"feedback": 0.15, "user": 0.10, "project": 0.05, "reference": 0.0}.get(n["type"], 0.0)
                ),
                reverse=True,
            )
        except Exception:
            # Fallback to keyword path on any error
            if prompt_kw:
                relevant = [n for n in rest if _keyword_overlap(n, prompt_kw) >= MIN_KEYWORD_OVERLAP]
                relevant.sort(key=lambda n: _relevance(n, prompt_kw), reverse=True)
            else:
                relevant = []
    elif prompt_kw:
        relevant = [n for n in rest if _keyword_overlap(n, prompt_kw) >= MIN_KEYWORD_OVERLAP]
        relevant.sort(key=lambda n: _relevance(n, prompt_kw), reverse=True)
    else:
        relevant = []

    ordered = high + relevant
    if not ordered:
        sys.exit(0)

    # Filter out memories already in project cache — no need to re-inject
    if project_mem_dir:
        to_inject = [n for n in ordered if not _is_cached(n["id"], project_mem_dir)]
    else:
        to_inject = ordered

    if not to_inject:
        sys.exit(0)

    selected: list[tuple[dict, str]] = []
    used = 0
    for node in to_inject:
        block = _format(node)
        if used + len(block) > TOKEN_BUDGET:
            break
        selected.append((node, block))
        used += len(block) + 1

    if not selected:
        sys.exit(0)

    # Write project cache copies before injecting
    if project_mem_dir:
        raw_texts = {}
        if MEMORY_DIR.exists():
            for f in MEMORY_DIR.glob("*.md"):
                raw_texts[f.stem] = f.read_text(encoding="utf-8")
        for node, _ in selected:
            raw = raw_texts.get(node["id"], _format(node))
            _cache_memory(node, raw, project_mem_dir)

    print("## Jig Memory (cross-project knowledge)\n")
    print("\n\n---\n\n".join(block for _, block in selected))
    sys.exit(0)


if __name__ == "__main__":
    main()
