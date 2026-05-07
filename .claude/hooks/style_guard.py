#!/usr/bin/env python3
"""Rules Checker — PostToolUse hook for Edit/Write.

Checks modified files against language-specific rules defined in .claude/rules/.
Parses DON'T rules and scans file content for violations.
Outputs warnings via stderr so Claude sees them and can self-correct.

Protocol:
  stdin:  {"tool_name": "Edit", "tool_input": {"file_path": "..."}}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}   (never blocks — informational only)
  stderr: violation warnings (visible to agent)
  exit 0: always
"""

import json
import os
import re
import sys
from pathlib import Path

_APPROVE = json.dumps({"decision": "approve"})

# Map file extensions to rule file names and language labels
_EXT_MAP: dict[str, tuple[str, str]] = {
    ".ts": ("typescript", "TypeScript"),
    ".tsx": ("typescript", "TypeScript"),
    ".go": ("go", "Go"),
    ".py": ("python", "Python"),
    ".pyw": ("python", "Python"),
    ".rs": ("rust", "Rust"),
    ".lua": ("lua", "Lua"),
    ".php": ("php", "PHP"),
    ".swift": ("swift", "Swift"),
    ".java": ("java", "Java"),
    ".mts": ("typescript", "TypeScript"),
}

# Regex patterns to detect specific DON'T violations per language.
# Each entry: (pattern, description, flags)
# Only check for things that are unambiguously wrong.
_CHECKS: dict[str, list[tuple[str, str, int]]] = {
    "typescript": [
        (r"\bany\b(?!\s*\()", "Usage of `any` type — use `unknown` and narrow", 0),
        (r"@ts-ignore", "Using @ts-ignore — use @ts-expect-error if unavoidable", 0),
        (r"\benum\s+\w+", "Using `enum` — prefer `as const` objects or union types", 0),
        (r"\bnamespace\s+\w+", "Using `namespace` — use ES modules instead", 0),
    ],
    "go": [
        (r"panic\(", "Using panic() — return errors instead (unless in main/init)", 0),
        (r'context\.Context\b.*\bstruct\b', "Storing context.Context in struct — always pass as first param", 0),
        (r'\bfunc\s+\w+\([^)]*\)\s*{[^}]*\berr\s*:?=.*\n(?:[^}]*\n)*?(?!.*\berr\b)', "Possible ignored error — always handle errors", re.MULTILINE),
    ],
    "python": [
        (r"^from\s+\S+\s+import\s+\*", "Using `import *` — pollutes namespace", re.MULTILINE),
        (r"except\s*:", "Bare `except:` — catch specific exceptions", 0),
        (r"def\s+\w+\([^)]*=\s*\[\s*\]", "Mutable default argument `=[]` — use `None` and create inside", 0),
        (r"def\s+\w+\([^)]*=\s*\{\s*\}", "Mutable default argument `={}` — use `None` and create inside", 0),
        (r"\bos\.system\(", "Using os.system() — use subprocess.run() instead", 0),
        (r"subprocess\.\w+\([^)]*shell\s*=\s*True", "subprocess with shell=True — injection risk", 0),
    ],
    "rust": [
        (r"\.unwrap\(\)", "Using .unwrap() — use `?`, `.expect(\"reason\")`, or handle the error", 0),
        (r"unsafe\s*\{(?!\s*//\s*SAFETY:)", "unsafe block without // SAFETY: comment", 0),
        (r"\basync_std\b", "Using async-std — discontinued March 2025, use Tokio or smol", 0),
    ],
    "lua": [
        (r"^(?!.*\blocal\b)\s*(\w+)\s*=\s*(?!.*function\b)", "Possible accidental global — use `local`", re.MULTILINE),
        (r'(?:result|s|str)\s*=\s*(?:result|s|str)\s*\.\.\s*', "String concatenation in loop — use table.concat", 0),
        (r"\bos\.execute\(", "Using os.execute() — potential injection risk", 0),
    ],
    "php": [
        (r'(?<!=)(?<!\!)=\s*=\s*(?!=)', "Loose comparison (==) — use strict (===)", 0),
        (r"\beval\s*\(", "Using eval() — arbitrary code execution risk", 0),
        (r"@\s*\w+", "Using @ error suppression — handle errors explicitly", 0),
        (r"\bmysql_\w+\s*\(", "Using mysql_* functions — removed in PHP 7, use PDO", 0),
        (r'display_errors\s*=\s*["\']?[Oo]n', "display_errors = On — disable in production", 0),
    ],
    "swift": [
        (r"\bas!\s+", "Force cast (`as!`) — use `as?` with guard", 0),
        (r"DispatchQueue\.\w+\.async\s*\{", "Using DispatchQueue — prefer async/await or actors", 0),
        (r"Timer\.scheduledTimer\s*\(", "Using Timer.scheduledTimer — use Task.sleep in async code", 0),
        (r"\bclass\s+\w+\s*:\s*ObservableObject\b", "Using ObservableObject — prefer @Observable on iOS 17+", 0),
    ],
    "java": [
        (r"\.get\(\)\s*;", "Calling Optional.get() without check — use orElseThrow() or orElse()", 0),
        (r"\b(?:List|Map|Set)\s+\w+\s*=", "Possible raw type usage — always use generics (e.g. List<String>)", 0),
        (r'log\.\w+\("[^"]*"\s*\+', "String concatenation in log statement — use parameterized {} placeholders", 0),
        (r"@Autowired\s+(?:private|protected|public)", "Field injection with @Autowired — use constructor injection instead", 0),
    ],
}

# Files/paths to skip (tests, generated, vendored)
_SKIP_PATTERNS = [
    r"node_modules/",
    r"vendor/",
    r"\.git/",
    r"dist/",
    r"build/",
    r"target/",
    r"__pycache__/",
    r"\.min\.",
    r"\.generated\.",
    r"\.lock$",
]


def _should_skip(file_path: str) -> bool:
    """Skip generated, vendored, or test-infrastructure files."""
    for pattern in _SKIP_PATTERNS:
        if re.search(pattern, file_path):
            return True
    return False


def _is_test_file(file_path: str) -> bool:
    """Detect test files — some rules are relaxed in tests."""
    lower = file_path.lower()
    return any(marker in lower for marker in [
        "test_", "_test.", ".test.", ".spec.", "tests/", "test/",
        "testing/", "fixtures/", "conftest",
    ])


def _check_file(file_path: str, content: str, lang: str, is_test: bool) -> list[tuple[int, str]]:
    """Run checks and return list of (line_number, description) violations."""
    checks = _CHECKS.get(lang, [])
    if not checks:
        return []

    violations: list[tuple[int, str]] = []

    for pattern, description, flags in checks:
        # Skip unwrap() check in Rust test files — common and acceptable
        if lang == "rust" and "unwrap" in pattern and is_test:
            continue
        # Skip panic check in Go test/main files
        if lang == "go" and "panic" in pattern and is_test:
            continue

        try:
            for match in re.finditer(pattern, content, flags):
                # Find line number
                line_num = content[:match.start()].count("\n") + 1
                violations.append((line_num, description))
        except re.error:
            continue

    # Deduplicate by description (report each violation type once with first occurrence)
    seen_descriptions: dict[str, int] = {}
    counts: dict[str, int] = {}
    for line_num, desc in violations:
        if desc not in seen_descriptions:
            seen_descriptions[desc] = line_num
            counts[desc] = 1
        else:
            counts[desc] += 1

    deduped = []
    for desc, first_line in seen_descriptions.items():
        count = counts[desc]
        if count > 1:
            deduped.append((first_line, f"{desc} ({count} occurrences, first at line {first_line})"))
        else:
            deduped.append((first_line, f"{desc} (line {first_line})"))

    return deduped


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    # Extract file path
    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", tool_input.get("path", ""))
    if not file_path:
        file_path = os.environ.get("FILE", "")

    if not file_path:
        print(_APPROVE)
        return

    # Determine language
    ext = Path(file_path).suffix.lower()
    lang_info = _EXT_MAP.get(ext)
    if not lang_info:
        print(_APPROVE)
        return

    lang, lang_label = lang_info

    # Skip vendored/generated files
    if _should_skip(file_path):
        print(_APPROVE)
        return

    # Read file content
    try:
        content = Path(file_path).read_text(encoding="utf-8", errors="replace")
    except Exception:
        print(_APPROVE)
        return

    # Skip very small files (likely empty or trivial)
    if len(content.strip()) < 10:
        print(_APPROVE)
        return

    is_test = _is_test_file(file_path)
    violations = _check_file(file_path, content, lang, is_test)

    if violations:
        filename = Path(file_path).name
        lines = [f"⚠ {lang_label} Rules Check — {len(violations)} violation{'s' if len(violations) > 1 else ''} in {filename}:"]
        for _, desc in violations[:8]:  # Cap at 8 to avoid noise
            lines.append(f"  ✗ {desc}")
        if len(violations) > 8:
            lines.append(f"  ... and {len(violations) - 8} more")
        lines.append(f"  → Review .claude/rules/{lang_info[0]}.md for full rules")
        print("\n".join(lines), file=sys.stderr)

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(_APPROVE)
