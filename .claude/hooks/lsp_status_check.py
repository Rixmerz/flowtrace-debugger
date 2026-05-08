#!/usr/bin/env python3
"""SessionStart hook: reports LSP coverage for the current project."""

import json
import os
import sys
from pathlib import Path

PLUGINS_FILE = Path.home() / ".claude" / "plugins" / "installed_plugins.json"

# Extension → display name mapping (subset of what claude-lsp-setup handles)
EXT_TO_LANG = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "typescript", ".jsx": "typescript",
    ".mts": "typescript", ".cts": "typescript", ".mjs": "typescript", ".cjs": "typescript",
    ".py": "python", ".pyi": "python",
    ".rs": "rust",
    ".go": "go",
    ".c": "c/cpp", ".cpp": "c/cpp", ".cc": "c/cpp", ".h": "c/cpp", ".hpp": "c/cpp",
    ".cs": "csharp",
    ".java": "java",
    ".kt": "kotlin", ".kts": "kotlin",
    ".lua": "lua",
    ".php": "php",
    ".swift": "swift",
}

LANG_TO_PLUGIN = {
    "typescript": "typescript-lsp",
    "python": "pyright-lsp",
    "rust": "rust-analyzer-lsp",
    "go": "gopls-lsp",
    "c/cpp": "clangd-lsp",
    "csharp": "csharp-lsp",
    "java": "jdtls-lsp",
    "kotlin": "kotlin-lsp",
    "lua": "lua-lsp",
    "php": "php-lsp",
    "swift": "swift-lsp",
}

SKIP_DIRS = {
    "node_modules", ".git", "target", "build", "dist", "__pycache__",
    ".venv", "venv", "vendor", "Pods", ".gradle", "bin", "obj",
}


def get_installed_plugins() -> set[str]:
    if not PLUGINS_FILE.exists():
        return set()
    try:
        data = json.loads(PLUGINS_FILE.read_text())
        return {k.split("@")[0] for k in data.get("plugins", {})}
    except (json.JSONDecodeError, KeyError):
        return set()


def scan_languages(project_dir: str, max_files: int = 200) -> set[str]:
    langs = set()
    count = 0
    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in EXT_TO_LANG:
                langs.add(EXT_TO_LANG[ext])
            count += 1
            if count >= max_files:
                return langs
    return langs


def main():
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    if not Path(project_dir).is_dir():
        return

    installed = get_installed_plugins()
    detected = scan_languages(project_dir)

    if not detected:
        return

    active = []
    missing = []
    for lang in sorted(detected):
        plugin = LANG_TO_PLUGIN.get(lang)
        if plugin and plugin in installed:
            active.append(lang)
        elif plugin:
            missing.append(lang)

    parts = []
    if active:
        tick = "\u2713"
        parts.append(f"[LSP] Active: {', '.join(f'{lang} {tick}' for lang in active)}")
    if missing:
        parts.append(f"[LSP] Missing: {', '.join(missing)} (run: claude-lsp-setup .)")

    if parts:
        print("\n".join(parts), file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # Fail-safe: SessionStart hook must never crash
