"""Quick OpenRouter smoke test (does not print API key)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / "backend" / ".env"


def load_key() -> str:
    text = ENV_PATH.read_text(encoding="utf-8-sig")
    match = re.search(r"^LLM_API_KEY=(.+)$", text, re.M)
    if not match:
        raise SystemExit("LLM_API_KEY missing in backend/.env")
    return match.group(1).strip().strip("\ufeff")


def main() -> None:
    from openai import OpenAI

    client = OpenAI(api_key=load_key(), base_url="https://openrouter.ai/api/v1")
    params = {
        "model": "qwen/qwen3.5-flash-02-23",
        "messages": [{"role": "user", "content": 'Reply with JSON only: {"ok": true}'}],
        "max_tokens": 200,
        "temperature": 0.2,
        "extra_body": {"reasoning": {"effort": "none"}},
    }
    response = client.chat.completions.create(**params)
    choices = response.choices or []
    print("choices", len(choices))
    print("model", response.model)
    if not choices:
        print("empty response object:", response)
        return
    choice = choices[0]
    content = (choice.message.content or "") if choice.message else ""
    print("finish_reason", choice.finish_reason)
    print("content_len", len(content))
    print("content_preview", content[:200])


if __name__ == "__main__":
    main()
