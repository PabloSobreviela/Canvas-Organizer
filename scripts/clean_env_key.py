"""Strip BOM / zero-width chars from LLM_API_KEY in backend/.env (no output of secret)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / "backend" / ".env"


def clean_value(raw: str) -> str:
    return raw.strip().strip("\ufeff").strip("\u200b").strip('"').strip("'")


def main() -> int:
    if not ENV_PATH.is_file():
        print(f"Missing {ENV_PATH}", file=sys.stderr)
        return 1

    text = ENV_PATH.read_text(encoding="utf-8-sig")
    lines: list[str] = []
    changed = False

    for line in text.splitlines():
        match = re.match(r"^(\s*LLM_API_KEY\s*=\s*)(.+)\s*$", line)
        if match:
            prefix, raw = match.group(1), match.group(2)
            cleaned = clean_value(raw)
            changed = changed or cleaned != raw.strip()
            lines.append(prefix + cleaned)
        else:
            lines.append(line)

    if changed:
        ENV_PATH.write_text(
            "\n".join(lines) + ("\n" if text.endswith("\n") else ""),
            encoding="utf-8",
        )
        print("env cleaned: True")
    else:
        print("env cleaned: False")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
