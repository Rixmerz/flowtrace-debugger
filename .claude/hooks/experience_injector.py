#!/usr/bin/env python3
"""Experience Memory Injector — PreToolUse hook for Write/Edit.

Reads experience memory JSONs and injects relevant memories as context
when the agent modifies files. Self-contained (no MCP imports).

Protocol (same as graph_enforcer.py):
  stdin:  {"tool_name": "Write", ...}
  env:    FILE (path being modified), CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}  (never blocks)
  stderr: experience memory context (visible to agent)
  exit 0: always
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import _DOMAIN_MAP, extract_keywords, guess_domain


def _score_entry(entry: dict, target_path: str, target_kws: list[str],
                 target_domain: str) -> float:
    """Compute relevance score (simplified inline version)."""
    # Path match
    pattern = entry.get("file_pattern", "")
    path_score = 0.0
    if pattern:
        try:
            regex = pattern.replace("*", ".*")
            if re.fullmatch(regex, target_path):
                path_score = 1.0
            elif str(Path(pattern).parent) == str(Path(target_path).parent):
                path_score = 0.7
        except re.error:
            pass

    # Keyword overlap (Jaccard)
    entry_kws = set(entry.get("keywords", []))
    target_set = set(target_kws)
    kw_score = 0.0
    if entry_kws and target_set:
        kw_score = len(entry_kws & target_set) / len(entry_kws | target_set)

    # Domain match
    domain_score = 1.0 if entry.get("domain") == target_domain else 0.0

    # Confidence
    conf = entry.get("confidence", 0.3)

    return path_score * 0.30 + kw_score * 0.25 + domain_score * 0.20 + conf * 0.15


def _get_embedding_cache():
    """Load embedding cache from global DCC DB. Returns dict {entry_id: np.ndarray} or None."""
    try:
        import sqlite3
        db_path = Path.home() / ".deltacodecube" / "embeddings.db"
        if not db_path.exists():
            return None
        conn = sqlite3.connect(str(db_path), timeout=2)
        rows = conn.execute(
            "SELECT id, embedding FROM embeddings WHERE source='experience'"
        ).fetchall()
        conn.close()
        if not rows:
            return None
        import numpy as np
        return {row[0]: np.array(json.loads(row[1]), dtype=np.float32) for row in rows}
    except Exception:
        return None


def _embed_text(text: str) -> "np.ndarray | None":
    """Embed text via Ollama. Returns 768D array or None."""
    try:
        import urllib.request
        import numpy as np
        payload = json.dumps({"model": "nomic-embed-text", "input": text}).encode()
        req = urllib.request.Request(
            "http://localhost:11434/api/embed",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            embs = data.get("embeddings", [])
            return np.array(embs[0], dtype=np.float32) if embs else None
    except Exception:
        return None


def _cosine_sim(a, b) -> float:
    """Cosine similarity between two numpy arrays."""
    import numpy as np
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _load_entries(path: Path) -> list[dict]:
    """Load entries from a memory JSON file."""
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return data.get("entries", [])
    except Exception:
        return []


def main():
    # Always approve — this hook is informational only
    approve = json.dumps({"decision": "approve"})

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(approve)
        return

    # Get the file being modified
    file_path = os.environ.get("FILE", "")
    if not file_path:
        # Try to extract from tool_input
        tool_input = hook_input.get("tool_input", {})
        file_path = tool_input.get("file_path", tool_input.get("path", ""))

    if not file_path:
        print(approve)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    project_name = Path(project_dir).name if project_dir else ""

    # Load memory files
    wm_dir = Path.home() / ".local" / "share" / "jig"
    global_entries = _load_entries(wm_dir / "experience_memory.json")

    project_entries = []
    if project_name:
        project_entries = _load_entries(
            wm_dir / "project_memories" / project_name / "experience_memory.json"
        )

    all_entries = global_entries + project_entries
    if not all_entries:
        print(approve)
        return

    # Score and rank
    target_kws = extract_keywords(file_path)
    target_domain = guess_domain(file_path)

    # Try embedding-based scoring (upgrade from keyword matching)
    embedding_cache = _get_embedding_cache()
    target_embedding = None
    use_embeddings = False
    if embedding_cache:
        # Build context string for embedding: filename + parent dir + domain
        embed_text = f"{Path(file_path).stem} {Path(file_path).parent.name} {target_domain}"
        target_embedding = _embed_text(embed_text)
        if target_embedding is not None:
            use_embeddings = True

    scored = []
    for entry in all_entries:
        # Base score from keywords + path + domain
        base_score = _score_entry(entry, file_path, target_kws, target_domain)

        # Upgrade with embedding similarity if available
        if use_embeddings and entry.get("id") in embedding_cache:
            emb_score = _cosine_sim(target_embedding, embedding_cache[entry["id"]])
            # Blend: 60% embedding, 40% keyword (embeddings are more reliable)
            score = emb_score * 0.60 + base_score * 0.40
        else:
            score = base_score

        if score > 0.10:
            scored.append((entry, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:3]

    if top:
        filename = Path(file_path).name
        lines = [f"\u26a1 Experience Memory ({len(top)} match{'es' if len(top) > 1 else ''} for {filename}):"]
        for entry, score in top:
            occurrences = entry.get("occurrences", 1)
            desc = entry.get("description", "")[:80]
            resolution = entry.get("resolution", "")
            lines.append(f"  [{score:.2f}] {desc} ({occurrences}x)")
            if resolution:
                lines.append(f"    \u2192 {resolution[:100]}")

        print("\n".join(lines), file=sys.stderr)

    print(approve)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(json.dumps({"decision": "approve"}))
