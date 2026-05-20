"""
Redact common PII patterns from course text before sending to an LLM.
Content anonymity cannot be fully guaranteed; this reduces obvious identifiers.
"""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    re.IGNORECASE,
)
_PHONE_RE = re.compile(
    r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b",
)
_GT_ID_RE = re.compile(r"\b\d{9}\b")
_URL_WITH_USER_RE = re.compile(
    r"https?://[^\s]*(?:user|profile|people)[^\s]*",
    re.IGNORECASE,
)


def sanitize_text_for_llm(text: str) -> str:
    if not text:
        return ""
    out = str(text)
    out = _EMAIL_RE.sub("[EMAIL]", out)
    out = _PHONE_RE.sub("[PHONE]", out)
    out = _GT_ID_RE.sub("[ID]", out)
    out = _URL_WITH_USER_RE.sub("[URL]", out)
    return out
