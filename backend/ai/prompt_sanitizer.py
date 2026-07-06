"""
Best-effort redaction of common PII patterns from course text before sending it
to an LLM.

IMPORTANT (honesty about limits): this is a regex-based reducer of *obvious*
identifiers, NOT a guarantee of anonymity. Free-text course materials can
contain names and other identifiers that no pattern can reliably catch. User
disclosures must describe this as best-effort, never as guaranteed redaction.
See docs/OIT_READINESS_AUDIT.md (R6).
"""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    re.IGNORECASE,
)
# SSN must run before the generic phone/ID patterns.
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_PHONE_RE = re.compile(
    r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b",
)
# GT student IDs are 9 digits; also catch 9-digit runs generally.
_GT_ID_RE = re.compile(r"\b\d{9}\b")
# Credit-card-like 13-16 digit runs (with optional separators).
_CARD_RE = re.compile(r"\b(?:\d[ -]?){13,16}\b")
_URL_WITH_USER_RE = re.compile(
    r"https?://[^\s]*(?:user|profile|people|login|enrollments?)[^\s]*",
    re.IGNORECASE,
)
# Canvas API access tokens / bearer tokens that may appear in pasted text.
_BEARER_RE = re.compile(r"\b(?:Bearer\s+)?[0-9]{3,5}~[A-Za-z0-9]{20,}\b")


def sanitize_text_for_llm(text: str) -> str:
    if not text:
        return ""
    out = str(text)
    out = _BEARER_RE.sub("[TOKEN]", out)
    out = _EMAIL_RE.sub("[EMAIL]", out)
    out = _SSN_RE.sub("[SSN]", out)
    out = _CARD_RE.sub("[CARD]", out)
    out = _PHONE_RE.sub("[PHONE]", out)
    out = _GT_ID_RE.sub("[ID]", out)
    out = _URL_WITH_USER_RE.sub("[URL]", out)
    return out
