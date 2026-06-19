#!/usr/bin/env python3
"""
Lightweight security hygiene checks for CI.
Exits non-zero when forbidden patterns are found in production paths.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_PATTERNS = [
    (re.compile(r"USING\s*\(\s*true\s*\)", re.I), "permissive RLS USING (true)"),
    (
        re.compile(r"localStorage\.setItem\(\s*['\"][^'\"]*token[^'\"]*['\"]", re.I),
        "localStorage token persistence",
    ),
    (re.compile(r"#token=", re.I), "JWT in URL fragment"),
    (re.compile(r"\?token=", re.I), "JWT in query string"),
]

SCAN_DIRS = [
    ROOT / "backend",
    ROOT / "frontend" / "src",
]

SKIP_PARTS = {
    "LEGACY_CODE",
    "LastWorking",
    ".bak",
    "node_modules",
    "__pycache__",
    "migrations",
    "docs",
    "backup-pre-mui",
    "App.js.bak",
}


def _should_skip(path: Path) -> bool:
    text = str(path)
    return any(part in text for part in SKIP_PARTS)


def main() -> int:
    errors: list[str] = []

    for base in SCAN_DIRS:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if _should_skip(path):
                continue
            if path.suffix not in {".py", ".js", ".jsx", ".sql", ".ts", ".tsx"}:
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                errors.append(f"{path}: read failed: {exc}")
                continue
            for pattern, label in FORBIDDEN_PATTERNS:
                if not pattern.search(content):
                    continue
                errors.append(f"{path}: {label}")

    if errors:
        print("Security check FAILED:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("Security check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
