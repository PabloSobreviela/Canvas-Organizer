"""Strip BOM / zero-width characters from DEEPINFRA_API_KEY in backend/.env.

This helper never prints the secret value.
"""

from pathlib import Path
import re


ENV_PATH = Path(__file__).resolve().parents[1] / "backend" / ".env"


def main() -> None:
    if not ENV_PATH.exists():
        raise SystemExit("backend/.env not found")

    text = ENV_PATH.read_text(encoding="utf-8-sig")
    changed = False
    lines = []
    for line in text.splitlines():
        match = re.match(r"^(\s*DEEPINFRA_API_KEY\s*=\s*)(.+)\s*$", line)
        if match:
            cleaned = match.group(2).strip().strip("\ufeff").strip("\u200b")
            line = match.group(1) + cleaned
            changed = True
        lines.append(line)

    if not changed:
        raise SystemExit("DEEPINFRA_API_KEY not found")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Cleaned DEEPINFRA_API_KEY without displaying it.")


if __name__ == "__main__":
    main()
